let currentRoom = null;
const myPlayerId = localStorage.getItem('pid') || Math.random().toString(36).substring(7);
localStorage.setItem('pid', myPlayerId);

async function api(endpoint, data = {}) {
    data.playerId = myPlayerId; 
    return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json());
}

async function createGame(mode) {
    const count = document.getElementById('player-count-select').value;
    const res = await api('/api/create', { mode, maxPlayers: count });
    if (res.success) enterGame(res.roomCode);
}

async function joinGame() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length === 4) {
        const res = await api('/api/join', { roomCode: code });
        if (res.success) enterGame(code);
        else alert("Room not found");
    }
}

function enterGame(roomCode) {
    currentRoom = roomCode;
    document.getElementById('view-menu').classList.add('hidden');
    document.getElementById('view-game').classList.remove('hidden');
    document.getElementById('room-display').innerText = `Room: ${roomCode}`;
    pollGame();
    setInterval(pollGame, 2000); 
}

async function pollGame() {
    if (!currentRoom) return;
    
    // Note: We append ?playerId to the URL so the server knows who is asking
    const res = await fetch(`/api/game/${currentRoom}?playerId=${myPlayerId}`).then(r => r.json());

    if (res.status === 'finished') {
        showResult(res.completedText);
    } else {
        updateGameUI(res);
    }
}

function updateGameUI(state) {
    const inputArea = document.getElementById('input-area');
    const waitMsg = document.getElementById('wait-message');
    const prompt = document.getElementById('prompt-display');
    const status = document.getElementById('status-display');

    if (state.phase === 'submit') {
        if (state.hasSubmitted) {
            inputArea.classList.add('hidden');
            waitMsg.classList.remove('hidden');
            waitMsg.innerText = `Waiting… (${state.submittedCount}/${state.maxPlayers})`;
            prompt.innerText = "Submitted!";
            status.innerText = "Others are typing…";
        } else {
            inputArea.classList.remove('hidden');
            waitMsg.classList.add('hidden');
            prompt.innerText = `Enter a: ${state.currentBlank.toUpperCase()}`;
            status.innerText = "Your turn";
        }
    }

    if (state.phase === 'reveal') {
        inputArea.classList.add('hidden');
        waitMsg.classList.add('hidden');

        prompt.innerHTML = `
            <div>
                <h3>Round Results</h3>
                ${state.submissions.map(w => `<div>• ${w}</div>`).join('')}
            </div>
        `;
        status.innerText = "😂 Locking it in…";
    }
}


async function submitWord() {
    const word = document.getElementById('word-input').value;
    if (!word) return;
    
    const res = await api('/api/submit', { roomCode: currentRoom, word });
    if (res.success) {
        document.getElementById('word-input').value = '';
        pollGame(); // Update UI immediately to show wait screen
    }
}

function showResult(text) {
    currentRoom = null;
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');
    document.getElementById('story-content').innerHTML = text;
}
