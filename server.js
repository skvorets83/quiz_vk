const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new sqlite3.Database('./quiz.db');

app.use(express.json());
app.use(express.static(__dirname));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT UNIQUE, 
        password TEXT, 
        role TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS quizzes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        title TEXT, 
        category TEXT, 
        time_limit INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        quiz_id INTEGER, 
        type TEXT, 
        text TEXT, 
        image_url TEXT, 
        options TEXT, 
        correct_answer TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        username TEXT, 
        quiz_title TEXT, 
        score INTEGER, 
        date TEXT
    )`);
});

app.post('/api/register', async (req, res) => {
    const { username, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password, role) VALUES (?, ?, ?)`, [username, hash, role], (err) => {
            if (err) {
                return res.status(400).json({ error: 'Пользователь с таким именем уже существует' });
            }
            res.json({ success: true });
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }
        res.json({ username: user.username, role: user.role });
    });
});

app.post('/api/create-quiz', (req, res) => {
    const { title, category, timeLimit, questions } = req.body;

    db.run(`INSERT INTO quizzes (title, category, time_limit) VALUES (?, ?, ?)`, [title, category, timeLimit], function (err) {
        if (err) return res.status(500).json({ error: 'Ошибка сохранения' });

        const quiz_id = this.lastID;
        const stmt = db.prepare(`INSERT INTO questions (quiz_id, type, text, image_url, options, correct_answer) VALUES (?, ?, ?, ?, ?, ?)`);

        questions.forEach(q => {
            const opts_str = JSON.stringify(q.options || []);
            stmt.run(quiz_id, q.type, q.text, q.imageUrl || '', opts_str, String(q.correctAnswer));
        });

        stmt.finalize();
        res.json({ success: true });
    });
});

app.get('/api/quizzes', (req, res) => {
    db.all(`SELECT * FROM quizzes ORDER BY id DESC`, (err, rows) => {
        res.json(rows || []);
    });
});

app.get('/api/history/:name', (req, res) => {
    db.all(`SELECT * FROM history WHERE username = ? ORDER BY id DESC`, [req.params.name], (err, rows) => {
        res.json(rows || []);
    });
});

const active_rooms = {};

io.on('connection', (socket) => {

    socket.on('createRoom', ({ code, quizId }) => {
        socket.join(code);
        db.get(`SELECT * FROM quizzes WHERE id = ?`, [quizId], (err, quiz) => {
            db.all(`SELECT * FROM questions WHERE quiz_id = ?`, [quizId], (err, questions) => {
                active_rooms[code] = {
                    title: quiz ? quiz.title : 'Квиз',
                    time_limit: quiz ? quiz.time_limit : 15,
                    questions: questions || [],
                    current_q: -1,
                    scores: {},
                    timer_id: null,
                    accept_answers: false
                };
                socket.emit('message', `Комната ${code} успешно создана`);
            });
        });
    });

    socket.on('joinRoom', ({ name, code }) => {
        const room = active_rooms[code];
        if (!room) {
            return socket.emit('errorMsg', 'Комната не найдена!');
        }
        socket.join(code);
        socket.room_code = code;
        socket.user_name = name;

        room.scores[name] = 0;
        io.to(code).emit('updatePlayers', Object.keys(room.scores));
    });

    socket.on('adminNextQuestion', (code) => {
        const room = active_rooms[code];
        if (!room) return;

        room.current_q++;

        if (room.current_q < room.questions.length) {
            const q = room.questions[room.current_q];
            room.accept_answers = true;

            io.to(code).emit('showQuestion', {
                text: q.text,
                type: q.type,
                image_url: q.image_url,
                options: JSON.parse(q.options || '[]'),
                index: room.current_q,
                total: room.questions.length
            });

            let time_left = room.time_limit;
            clearInterval(room.timer_id);

            io.to(code).emit('timerUpdate', time_left);
            room.timer_id = setInterval(() => {
                time_left--;
                if (time_left <= 0) {
                    clearInterval(room.timer_id);
                    room.accept_answers = false;
                    io.to(code).emit('timeIsUp');
                } else {
                    io.to(code).emit('timerUpdate', time_left);
                }
            }, 1000);

        } else {

            clearInterval(room.timer_id);
            const date_str = new Date().toLocaleDateString();

            Object.entries(room.scores).forEach(([player, score]) => {
                db.run(`INSERT INTO history (username, quiz_title, score, date) VALUES (?, ?, ?, ?)`, [player, room.title, score, date_str]);
            });

            io.to(code).emit('gameOver', room.scores);
            delete active_rooms[code];
        }
    });

    socket.on('submitAnswer', ({ name, code, answer }) => {
        const room = active_rooms[code];
        if (!room || !room.accept_answers) return;

        const q = room.questions[room.current_q];
        let is_correct = false;

        if (q.type === 'single') {
            is_correct = String(answer) === String(q.correct_answer);
        } else if (q.type === 'text') {
            is_correct = String(answer).trim().toLowerCase() === String(q.correct_answer).trim().toLowerCase();
        } else if (q.type === 'multiple') {
            const user_ans = Array.isArray(answer) ? answer.sort().join(',') : String(answer);
            const correct_ans = q.correct_answer.split(',').map(s => s.trim()).sort().join(',');
            is_correct = user_ans === correct_ans;
        }

        if (is_correct) {
            room.scores[name] = (room.scores[name] || 0) + 10;
        }
    });

    socket.on('disconnect', () => {
        if (socket.room_code && active_rooms[socket.room_code]) {
            delete active_rooms[socket.room_code].scores[socket.user_name];
            io.to(socket.room_code).emit('updatePlayers', Object.keys(active_rooms[socket.room_code].scores));
        }
    });
});

server.listen(3000, () => {
    console.log('tap on http://localhost:3000');
});