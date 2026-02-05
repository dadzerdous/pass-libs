let currentRoom = null;
const BASE_URL = "https://pass-libs.onrender.com";
const myPlayerId = localStorage.getItem('pid') || Math.random().toString(36).substring(7);
localStorage.setItem('pid', myPlayerId);

async function api(endpoint, data = {}) {
    data.playerId = myPlayerId; 
    // We add BASE_URL so it knows where to find the server
    return fetch(BASE_URL + endpoint, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json());
}

async function createGame(mode) {
    let name = document.getElementById('player-name-input').value;
    const count = document.getElementById('player-count-select').value;
    // Read the checkbox
    const isPublic = document.getElementById('public-check').checked;
    
    if (count == 1 && !name) name = "Me";
    if (!name) return alert("Please enter your name!");

    // Send isPublic to server
    const res = await api('/api/create', { mode, maxPlayers: count, playerName: name, isPublic });
    if (res.success) enterGame(res.roomCode);
}

// --- NEW BROWSER FUNCTIONS ---

async function browseGames() {
    const name = document.getElementById('player-name-input').value;
    if (!name) return alert("Please enter your name first!");

    const browser = document.getElementById('browser-area');
    const list = document.getElementById('public-games-list');
    
    browser.classList.remove('hidden');
    list.innerHTML = "Loading...";

    const res = await fetch('/api/list').then(r => r.json());

    list.innerHTML = ""; // Clear loading text

    if (res.success && res.games.length > 0) {
        res.games.forEach(g => {
            const btn = document.createElement('button');
            // Style: "HostName (2/4) - SFW"
            btn.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span>${g.hostName}'s Room</span>
                    <span style="font-size:0.8em; background: rgba(0,0,0,0.2); padding: 2px 8px; border-radius: 10px;">
                        ${g.playerCount}/${g.maxPlayers}
                    </span>
                </div>
                <div style="font-size: 0.7em; opacity: 0.8; text-align: left;">
                    ${g.mode.toUpperCase()} • Code: ${g.roomCode}
                </div>
            `;
            btn.className = g.mode === 'nsfw' ? 'btn-danger' : 'btn-primary';
            btn.style.padding = "10px";
            btn.onclick = () => joinPublicGame(g.roomCode);
            list.appendChild(btn);
        });
    } else {
        list.innerHTML = "<p>No public games found. Create one!</p>";
    }
}

function joinPublicGame(code) {
    document.getElementById('room-code-input').value = code;
    joinGame(); // Reuse existing join logic
}

function closeBrowser() {
    document.getElementById('browser-area').classList.add('hidden');
}

async function joinGame() {
    const name = document.getElementById('player-name-input').value;
    if (!name) return alert("Please enter your name!");

    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (code.length === 4) {
        const res = await api('/api/join', { roomCode: code, playerName: name });
        if (res.success) enterGame(code);
        else alert("Room not found");
    }
}

async function forceStart() {
    await api('/api/start', { roomCode: currentRoom });
}

async function startReplay() {
    await api('/api/replay', { roomCode: currentRoom });
    // Don't need to do anything else, the polling will catch the reset
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
    const res = await fetch(`/api/game/${currentRoom}?playerId=${myPlayerId}`).then(r => r.json());

    if (res.status === 'finished') {
        showResult(res.completedText);
    } else {
        // If we were at result screen, but status is now playing, switch back!
        document.getElementById('view-result').classList.add('hidden');
        document.getElementById('view-game').classList.remove('hidden');
        updateGameUI(res);
    }
}

function updateGameUI(state) {
    const lobbyArea = document.getElementById('lobby-area');
    const gameplayArea = document.getElementById('gameplay-area');
    const inputArea = document.getElementById('input-area');
    const votingArea = document.getElementById('voting-area');
    const waitMsg = document.getElementById('wait-message');
    const prompt = document.getElementById('prompt-display');
    const forceBtn = document.getElementById('force-start-btn');

    // Reset visibility
    lobbyArea.classList.add('hidden');
    gameplayArea.classList.add('hidden');
    inputArea.classList.add('hidden');
    votingArea.classList.add('hidden');
    waitMsg.classList.add('hidden');

    if (state.phase === 'lobby') {
        lobbyArea.classList.remove('hidden');
        document.getElementById('player-status').innerText = `${state.connectedPlayers} / ${state.maxPlayers} Joined`;
        document.getElementById('player-list').innerHTML = state.playerNames.map(name => `• ${name}`).join('<br>');
        
        // Show Start Button ONLY if Host
        if (state.isHost) {
            forceBtn.classList.remove('hidden');
        } else {
            forceBtn.classList.add('hidden');
        }

    } else {
        gameplayArea.classList.remove('hidden');
        if (state.phase === 'writing') {
            if (state.hasSubmitted) {
                waitMsg.classList.remove('hidden');
                waitMsg.innerText = `Waiting for players... (${state.submittedCount}/${state.maxPlayers})`;
                prompt.innerText = "Submitted!";
            } else {
                inputArea.classList.remove('hidden');
                prompt.innerText = `Enter a: ${state.currentBlank.toUpperCase()}`;
            }
        } else if (state.phase === 'voting') {
            prompt.innerText = "Vote for your favorite!";
            if (state.hasVoted) {
                waitMsg.classList.remove('hidden');
                waitMsg.innerText = `Waiting for votes... (${state.voteCount}/${state.maxPlayers})`;
            } else {
                votingArea.classList.remove('hidden');
                renderCandidates(state.candidates);
            }
        }
    }
}

function renderCandidates(candidates) {
    const list = document.getElementById('candidates-list');
    list.innerHTML = ''; 
    candidates.forEach((word, index) => {
        const btn = document.createElement('button');
        btn.innerText = word;
        btn.className = 'btn-secondary'; 
        btn.onclick = () => submitVote(index);
        list.appendChild(btn);
    });
}

async function submitWord() {
    const word = document.getElementById('word-input').value;
    if (!word) return;
    
    const res = await api('/api/submit', { roomCode: currentRoom, word });
    if (res.success) {
        document.getElementById('word-input').value = '';
        pollGame(); 
    }
}

async function submitVote(index) {
    const res = await api('/api/vote', { roomCode: currentRoom, candidateIndex: index });
    if (res.success) {
        pollGame();
    }
}

function showResult(text) {
    // Keep currentRoom active so we can replay
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');
    document.getElementById('story-content').innerHTML = text;
}
