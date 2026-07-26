const socket = io();
let current_user = null;
let current_role = null;
let current_screen = "auth-screen";
let active_code = "";
let questions_data = [];

function change_screen(id) {
    document.getElementById(current_screen).classList.remove('active');
    document.getElementById(id).classList.add('active');
    current_screen = id;
}

async function handler_register() {
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    const role = document.getElementById('auth-role').value;

    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
    });
    const data = await res.json();
    if (data.error) {
        alert(data.error);
    } else {
        alert('Регистрация успешна! Теперь выполните вход.');
    }
}

async function handler_login() {
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;

    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.error) {
        return alert(data.error);
    }

    current_user = data.username;
    current_role = data.role;
    go_to_cabinet();
}

async function go_to_cabinet() {
    change_screen('cabinet-screen');
    document.getElementById('cab-name').innerText = current_user;
    document.getElementById('cab-role').innerText = current_role;

    if (current_role === 'организатор') {
        document.getElementById('organizer-controls').style.display = 'block';
        document.getElementById('player-controls').style.display = 'none';
        load_quiz_list();
    } else {
        document.getElementById('player-controls').style.display = 'block';
        document.getElementById('organizer-controls').style.display = 'none';
    }

    const res = await fetch(`/api/history/${current_user}`);
    const history = await res.json();
    const box = document.getElementById('history-list');
    box.innerHTML = history.length ? history.map(h =>
        `<div class="list-group-item d-flex justify-content-between align-items-center">
            ${h.quiz_title} <span class="badge bg-primary rounded-pill">${h.score} б.</span>
        </div>`
    ).join('') : '<div class="text-muted p-2">История пуста</div>';
}

async function load_quiz_list() {
    const res = await fetch('/api/quizzes');
    const quizzes = await res.json();
    const select = document.getElementById('org-quiz-select');
    select.innerHTML = quizzes.map(q => `<option value="${q.id}">${q.title} (${q.category})</option>`).join('');
}

function add_question_form() {
    const container = document.getElementById('questions-builder');
    const qIndex = container.children.length;

    const div = document.createElement('div');
    div.className = 'card p-3 mb-2 bg-light q-block';
    div.innerHTML = `
        <h6>Вопрос #${qIndex + 1}</h6>
        <input type="text" class="form-control mb-2 q-text" placeholder="Текст вопроса">
        <input type="text" class="form-control mb-2 q-img" placeholder="Ссылка на картинку (URL, опционально)">
        <select class="form-select mb-2 q-type">
            <option value="single">Одиночный выбор</option>
            <option value="multiple">Множественный выбор</option>
            <option value="text">Текстовый ответ</option>
        </select>
        <input type="text" class="form-control mb-2 q-opts" placeholder="Варианты через запятую (для выборов)">
        <input type="text" class="form-control mb-2 q-ans" placeholder="Правильный ответ (индекс 0,1.. или слова)">
    `;
    container.appendChild(div);
}

async function save_created_quiz() {
    const title = document.getElementById('qz-title').value;
    const category = document.getElementById('qz-category').value;
    const timeLimit = document.getElementById('qz-time').value;

    const blocks = document.querySelectorAll('.q-block');
    const questions = [];

    blocks.forEach(b => {
        const opts = b.querySelector('.q-opts').value.split(',').map(s => s.trim()).filter(Boolean);
        questions.push({
            text: b.querySelector('.q-text').value,
            imageUrl: b.querySelector('.q-img').value,
            type: b.querySelector('.q-type').value,
            options: opts,
            correctAnswer: b.querySelector('.q-ans').value
        });
    });

    const res = await fetch('/api/create-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, category, timeLimit, questions })
    });
    const data = await res.json();
    if (data.success) {
        alert('Квиз успешно создан!');
        go_to_cabinet();
    }
}

function create_quiz_room() {
    active_code = document.getElementById('new-room-code').value;
    const quizId = document.getElementById('org-quiz-select').value;
    if (!active_code) {
        return alert('Введите код!');
    }
    socket.emit('createRoom', { code: active_code, quizId });
}

function admin_next_question() {
    socket.emit('adminNextQuestion', active_code);
}

function join_quiz_room() {
    active_code = document.getElementById('play-room-code').value;
    if (!active_code) {
        return alert('Введите код!');
    }
    socket.emit('joinRoom', { name: current_user, code: active_code });
    change_screen('game-screen');
    document.getElementById('q-text').innerText = "Ожидаем старта от организатора...";
}

function send_answer(val) {
    socket.emit('submitAnswer', { name: current_user, code: active_code, answer: val });
    const status = document.getElementById('game-status');
    status.style.display = 'block';
    status.innerText = "Ваш ответ принят!";
}

function disable_answers() {
    const btns = document.querySelectorAll('#answers-container button, #answers-container input');
    btns.forEach(b => b.disabled = true);
}

socket.on('updatePlayers', (players) => {
    const count = document.getElementById('admin-players-count');
    if (count) count.innerText = players.length;
});

socket.on('showQuestion', (q) => {
    if (current_role!="организатор"){

    
    change_screen('game-screen');
    }
    document.getElementById('game-status').style.display = 'none';
    document.getElementById('q-text').innerText = q.text;
    document.getElementById('q-counter').innerText = `Вопрос ${q.index + 1} из ${q.total}`;

    const imgContainer = document.getElementById('q-image-container');
    imgContainer.innerHTML = q.image_url ? `<img src="${q.image_url}" class="img-fluid rounded max-h-200">` : '';

    const container = document.getElementById('answers-container');
    container.innerHTML = "";

    if (q.type === 'single') {
        q.options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-outline-primary py-2 m-1';
            btn.innerText = opt;
            btn.onclick = () => { send_answer(idx); disable_answers(); };
            container.appendChild(btn);
        });
    }
    else if (q.type === 'multiple') {
        q.options.forEach((opt, idx) => {
            container.innerHTML += `
                <div class="form-check text-start">
                    <input class="form-check-input m-check" type="checkbox" value="${idx}" id="m-${idx}">
                    <label class="form-check-label" for="m-${idx}">${opt}</label>
                </div>
            `;
        });
        const btn = document.createElement('button');
        btn.className = 'btn btn-success mt-2';
        btn.innerText = 'Отправить выбранное';
        btn.onclick = () => {
            const selected = Array.from(document.querySelectorAll('.m-check:checked')).map(c => c.value);
            send_answer(selected);
            disable_answers();
        };
        container.appendChild(btn);
    }
    else if (q.type === 'text') {
        container.innerHTML = `
            <input type="text" id="text-ans-input" class="form-control mb-2" placeholder="Введите ваш ответ">
            <button id="text-ans-btn" class="btn btn-success">Отправить</button>
        `;
        document.getElementById('text-ans-btn').onclick = () => {
            const val = document.getElementById('text-ans-input').value;
            send_answer(val);
            disable_answers();
        };
    }
});

socket.on('timerUpdate', (time) => {
    document.getElementById('timer-display').innerText = time;
});

socket.on('timeIsUp', () => {
    const status = document.getElementById('game-status');
    status.style.display = 'block';
    status.className = 'alert alert-danger py-2';
    status.innerText = "Время вышло!";
    disable_answers();
});

socket.on('gameOver', (scores) => {
    change_screen('results-screen');
    const board = document.getElementById('leaderboard');
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    board.innerHTML = sorted.map(([name, score]) =>
        `<li class="list-group-item d-flex justify-content-between align-items-center">
            <strong>${name}</strong>
            <span class="badge bg-success rounded-pill">${score} баллов</span>
        </li>`
    ).join('');
});

socket.on('errorMsg', (msg) => alert(msg));
socket.on('message', (msg) => console.log(msg));
add_question_form();