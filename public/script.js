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
    const name = document.getElementById('player-name-input').value;
    if (!name) return alert("Please enter your name!");

    const count = document.getElementById('player-count-select').value;
    // Send name AND maxPlayers
    const res = await api('/api/create', { mode, maxPlayers: count, playerName: name });
    if (res.success) enterGame(res.roomCode);
}

async function joinGame() {
    const name = document.getElementById('player-name-input').value;
    if (!name) return alert("Please enter your name!");

    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length === 4) {
        // Send name
        const res = await api('/api/join', { roomCode: code, playerName: name });
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

    if (state.hasSubmitted) {
        // I have submitted. Waiting for others.
        inputArea.classList.add('hidden');
        waitMsg.classList.remove('hidden');
        waitMsg.innerText = `Waiting for players... (${state.submittedCount}/${state.maxPlayers})`;
        prompt.innerText = "Submitted!";
    } else {
        // I need to submit.
        inputArea.classList.remove('hidden');
        waitMsg.classList.add('hidden');
        prompt.innerText = `Enter a: ${state.currentBlank.toUpperCase()}`;
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
