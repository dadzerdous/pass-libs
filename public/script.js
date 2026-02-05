let currentRoom = null;
const myPlayerId = localStorage.getItem('pid') || Math.random().toString(36).substring(7);
localStorage.setItem('pid', myPlayerId);

// 📖 HELPER DICTIONARY
const VOCAB_GUIDE = {
    "noun": "Person, place, or thing (e.g., Table, London, Cat)",
    "verb": "Action word (e.g., Run, Jump, Eat)",
    "adjective": "Descriptive word (e.g., Sticky, Blue, Fast)",
    "number": "Any number (e.g., 42, One Million)",
    "body part": "e.g., Elbow, Nose",
    "food": "e.g., Pizza, Slime",
    "animal": "e.g., Giraffe, Ant"
};

let showContext = false; // Toggle state

async function api(endpoint, data = {}) {
    data.playerId = myPlayerId; 
    return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    }).then(r => r.json());
}

async function leaveGame() {
    if (!currentRoom) return;
    
    if (confirm("Are you sure you want to leave?")) {
        await api('/api/leave', { roomCode: currentRoom });
        location.reload(); // Refresh to go back to main menu
    }
}

async function createGame(mode) {
    let name = document.getElementById('player-name-input').value;
    const count = document.getElementById('player-count-select').value;
    const isPublic = document.getElementById('public-check').checked;
    
    if (count == 1 && !name) name = "Me";
    if (!name) return alert("Please enter your name!");

    const res = await api('/api/create', { mode, maxPlayers: count, playerName: name, isPublic });
    if (res.success) enterGame(res.roomCode);
}

async function browseGames() {
    const name = document.getElementById('player-name-input').value;
    if (!name) return alert("Please enter your name first!");

    const browser = document.getElementById('browser-area');
    const list = document.getElementById('public-games-list');
    
    browser.classList.remove('hidden');
    list.innerHTML = "Loading...";

    const res = await fetch('/api/list').then(r => r.json());

    list.innerHTML = ""; 

    if (res.success && res.games.length > 0) {
        res.games.forEach(g => {
            const btn = document.createElement('button');
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
    joinGame(); 
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
        else alert(res.error || "Room not found");
    }
}

async function forceStart() {
    await api('/api/start', { roomCode: currentRoom });
}

async function startReplay() {
    await api('/api/replay', { roomCode: currentRoom });
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
    
    try {
        const res = await fetch(`/api/game/${currentRoom}?playerId=${myPlayerId}`).then(r => r.json());

        // DETECT IF GAME WAS DELETED
        if (res.error === "Game not found") {
            alert("The host has disbanded the lobby.");
            location.reload();
            return;
        }

        if (res.status === 'finished') {
            if (document.getElementById('view-result').classList.contains('hidden')) {
                showResult(res.completedText);
            }
        } else {
            document.getElementById('view-result').classList.add('hidden');
            document.getElementById('view-game').classList.remove('hidden');
            updateGameUI(res);
        }
    } catch (e) {
        console.log("Polling error:", e);
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
    const vocabHint = document.getElementById('vocab-hint');
    const contextBox = document.getElementById('context-box');
    const contextText = document.getElementById('context-text');

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
        
        if (state.isHost) forceBtn.classList.remove('hidden');
        else forceBtn.classList.add('hidden');

    } else {
        gameplayArea.classList.remove('hidden');
        
        // CONTEXT TOGGLE LOGIC
        if (showContext) {
            contextBox.classList.remove('hidden');
            contextText.innerHTML = state.maskedStory;
        } else {
            contextBox.classList.add('hidden');
        }

        if (state.phase === 'writing') {
            if (state.hasSubmitted) {
                waitMsg.classList.remove('hidden');
                waitMsg.innerText = `Waiting for players... (${state.submittedCount}/${state.maxPlayers})`;
                prompt.innerText = "Submitted!";
                vocabHint.innerText = "";
            } else {
                inputArea.classList.remove('hidden');
                const wordType = state.currentBlank.toLowerCase();
                prompt.innerText = `Enter a: ${wordType.toUpperCase()}`;
                
                // Show Helper Text
                vocabHint.innerText = VOCAB_GUIDE[wordType] || "";
            }
        } else if (state.phase === 'voting') {
            prompt.innerText = "Vote for your favorite!";
            vocabHint.innerText = "";
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

function toggleContext() {
    showContext = !showContext;
    const btn = document.getElementById('toggle-context-btn');
    btn.innerText = showContext ? "Hide Full Story" : "Show Full Story";
    pollGame(); // Force refresh UI
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
    const wordInput = document.getElementById('word-input');
    const word = wordInput.value.trim();
    
    // NO SPACES ALLOWED CHECK
    if (!word) return;
    if (word.includes(' ')) {
        alert("Single words only! No spaces.");
        return;
    }
    
    const res = await api('/api/submit', { roomCode: currentRoom, word });
    if (res.success) {
        wordInput.value = '';
        pollGame(); 
    }
}

async function submitVote(index) {
    const res = await api('/api/vote', { roomCode: currentRoom, candidateIndex: index });
    if (res.success) {
        pollGame();
    }
}

// 🎭 READER MODE
let storySentences = [];
let storyIndex = 0;

function showResult(text) {
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-result').classList.remove('hidden');
    
    // Split text by punctuation (. ! ?)
    // This regex splits but keeps the delimiter
    const rawSentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
    storySentences = rawSentences.map(s => s.trim());
    storyIndex = 0;
    
    const container = document.getElementById('story-content');
    container.innerHTML = ""; // Clear old
    
    // Create the "Tap to Reveal" button
    const nextBtn = document.createElement('button');
    nextBtn.id = "reveal-btn";
    nextBtn.className = "btn-primary big-btn pulse";
    nextBtn.innerText = "👆 Tap to Reveal Story";
    nextBtn.onclick = revealNextSentence;
    
    container.appendChild(nextBtn);
}

function revealNextSentence() {
    const container = document.getElementById('story-content');
    const btn = document.getElementById('reveal-btn');
    
    if (storyIndex < storySentences.length) {
        const p = document.createElement('p');
        p.className = "fade-in";
        p.innerHTML = storySentences[storyIndex];
        p.style.marginBottom = "15px";
        container.insertBefore(p, btn); // Add text BEFORE the button
        storyIndex++;
        
        btn.innerText = "Next Line...";
        
        if (storyIndex >= storySentences.length) {
            btn.remove(); // Remove button at end
        }
    }
}
