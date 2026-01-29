let currentRoom = null;

// --- API HELPER ---
async function api(endpoint, data = {}) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return response.json();
}

// --- ACTIONS ---

async function createGame(mode) {
    const res = await api('/api/create', { mode });
    if (res.success) {
        enterGame(res.roomCode);
    }
}

function joinGame() {
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length === 4) {
        enterGame(code);
    } else {
        alert("Please enter a 4-letter code");
    }
}

function enterGame(roomCode) {
    currentRoom = roomCode;
    document.getElementById('view-menu').classList.add('hidden');
    document.getElementById('view-game').classList.remove('hidden');
    document.getElementById('room-display').innerText = `Room: ${roomCode}`;
    
    // Start polling the server every 2 seconds to see if it's our turn
    pollGame();
    setInterval(pollGame, 2000);
}

async function pollGame() {
    if (!currentRoom) return;

    try {
        const res = await fetch(`/api/game/${currentRoom}`).then(r => r.json());
        
        if (res.status === 'finished') {
            showResult(res.completedText);
        } else {
            // Update UI with current blank
            document.getElementById('prompt-display').innerText = `A ${res.currentBlank.toUpperCase()}`;
            document.getElementById('status-display').innerText = `Progress: ${res.progress} / ${res.totalBlanks}`;
        }
    } catch (e) {
        console.log("Polling error", e);
    }
}

async function submitWord() {
    const word = document.getElementById('word-input').value;
    if (!word) return;

    const res = await api('/api/submit', { roomCode: currentRoom, word });
    if (res.success) {
        document.getElementById('word-input').value = '';
        // In a real app, we would wait for the next person. 
        // For MVP, we just clear the box and let you type the next one 
        // (Pass the phone mode!)
        pollGame(); 
    }
}

function showResult(text) {
    currentRoom = null; // Stop polling
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');
    document.getElementById('story-content').innerHTML = text;
}
