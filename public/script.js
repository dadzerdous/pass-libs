let currentRoom = null;
// Generate a permanent ID for this browser tab
const myPlayerId = localStorage.getItem('pid') || Math.random().toString(36).substring(7);
localStorage.setItem('pid', myPlayerId);

async function api(endpoint, data = {}) {
    data.playerId = myPlayerId; // Always send who we are
    return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json());
}

async function createGame(mode) {
    const res = await api('/api/create', { mode });
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
    setInterval(pollGame, 2000); // Check server every 2 seconds
}

async function pollGame() {
    if (!currentRoom) return;
    const res = await fetch(`/api/game/${currentRoom}`).then(r => r.json());

    if (res.status === 'finished') {
        showResult(res.completedText);
    } else {
        // TURN LOGIC
        const isMyTurn = (res.currentPlayerId === myPlayerId);
        const inputContainer = document.getElementById('input-area');
        const waitMessage = document.getElementById('wait-message');

        if (isMyTurn) {
            // It IS my turn: Show inputs
            inputContainer.classList.remove('hidden');
            waitMessage.classList.add('hidden');
            document.getElementById('prompt-display').innerText = `Your Turn! Enter a: ${res.currentBlank.toUpperCase()}`;
        } else {
            // It is NOT my turn: Hide inputs
            inputContainer.classList.add('hidden');
            waitMessage.classList.remove('hidden');
            waitMessage.innerText = `Waiting for other player...`;
            document.getElementById('prompt-display').innerText = `(Their turn to pick a ${res.currentBlank})`;
        }
    }
}

async function submitWord() {
    const word = document.getElementById('word-input').value;
    if (!word) return;
    
    const res = await api('/api/submit', { roomCode: currentRoom, word });
    if (res.success) {
        document.getElementById('word-input').value = '';
        pollGame(); // Update screen immediately
    } else {
        alert(res.error || "Error");
    }
}

function showResult(text) {
    currentRoom = null;
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');
    document.getElementById('story-content').innerHTML = text;
}
