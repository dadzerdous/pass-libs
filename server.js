const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs'); // NEW: File System module
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

const games = {};

// --- LOAD TEMPLATES FROM FILE ---
let TEMPLATES = {};
try {
    const data = fs.readFileSync('templates.json', 'utf8');
    TEMPLATES = JSON.parse(data);
    console.log("Templates loaded successfully.");
} catch (err) {
    console.error("Error loading templates:", err);
    // Fallback if file missing
    TEMPLATES = { sfw: [], nsfw: [] }; 
}

const CPU_VOCAB = ["SPATULA", "MOIST", "GRANDMA", "EXPLOSION", "SLIPPERY", "BANANA", "SLIME", "AWKWARD", "SHINY", "WIGGLY"];

function generateId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- API ---

app.post('/api/create', (req, res) => {
    const { mode, playerId, playerName, maxPlayers } = req.body;
    const roomCode = generateId();
    // Default to SFW if mode invalid
    const category = (mode === 'nsfw' && TEMPLATES.nsfw) ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
    // Safety check if templates are empty
    if (!category || category.length === 0) {
        return res.json({ success: false, error: "No templates found!" });
    }

    const isSinglePlayer = parseInt(maxPlayers) === 1;
    const initialPhase = isSinglePlayer ? 'writing' : 'lobby';
    
    games[roomCode] = {
        id: roomCode,
        mode: mode,
        template: category[Math.floor(Math.random() * category.length)],
        maxPlayers: parseInt(maxPlayers) || 2,
        players: [playerId],
        names: { [playerId]: playerName || "You" },
        hostId: playerId,
        
        currentBlankIndex: 0,
        status: 'playing',
        phase: initialPhase,
        
        answers: [],            
        roundSubmissions: [],   
        roundVotes: {},         
        candidates: []          
    };

    res.json({ roomCode, success: true });
});

app.post('/api/join', (req, res) => {
    const { roomCode, playerId, playerName } = req.body;
    const game = games[roomCode];
    if (!game) return res.json({ success: false, error: "Game not found" });

    if (!game.players.includes(playerId)) {
        game.players.push(playerId);
        if (playerName) game.names[playerId] = playerName;
    }

    if (game.phase === 'lobby' && game.players.length >= game.maxPlayers) {
        game.phase = 'writing';
    }

    res.json({ success: true });
});

app.post('/api/start', (req, res) => {
    const { roomCode } = req.body;
    const game = games[roomCode];
    if (game) {
        game.phase = 'writing';
        game.maxPlayers = game.players.length; 
    }
    res.json({ success: true });
});

app.post('/api/replay', (req, res) => {
    const { roomCode } = req.body;
    const game = games[roomCode];
    if (game) {
        const category = game.mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
        game.template = category[Math.floor(Math.random() * category.length)];
        
        game.currentBlankIndex = 0;
        game.status = 'playing';
        game.phase = 'writing';
        game.answers = [];
        game.roundSubmissions = [];
        game.roundVotes = {};
        game.candidates = [];
    }
    res.json({ success: true });
});

app.get('/api/game/:code', (req, res) => {
    const game = games[req.params.code];
    if (!game) return res.status(404).json({ error: "Game not found" });
    
    const playerId = req.query.playerId;
    const hasSubmitted = game.roundSubmissions.some(s => s.playerId === playerId);
    const hasVoted = game.roundVotes[playerId] !== undefined;

    res.json({
        status: game.status,
        phase: game.phase,
        currentBlank: game.template.blanks[game.currentBlankIndex],
        progress: game.currentBlankIndex,
        totalBlanks: game.template.blanks.length,
        completedText: game.status === 'finished' ? compileStory(game) : null,
        
        connectedPlayers: game.players.length,
        maxPlayers: game.maxPlayers,
        playerNames: Object.values(game.names),
        isHost: game.hostId === playerId, 
        
        submittedCount: game.roundSubmissions.length,
        hasSubmitted: hasSubmitted,
        candidates: game.phase === 'voting' ? game.candidates.map(c => c.word) : [],
        hasVoted: hasVoted,
        voteCount: Object.keys(game.roundVotes).length
    });
});

app.post('/api/submit', (req, res) => {
    let { roomCode, word, playerId } = req.body;
    const game = games[roomCode];
    if (!game || game.status !== 'playing' || game.phase !== 'writing') return res.status(400).json({ error: "Invalid" });
    if (game.roundSubmissions.some(s => s.playerId === playerId)) return res.json({ success: false, error: "Already submitted" });

    // --- FIX: FORCE UPPERCASE & TRIM ---
    word = word.trim().toUpperCase(); 

    game.roundSubmissions.push({ playerId, word });
    
    if (game.roundSubmissions.length >= game.maxPlayers) {
        if (game.maxPlayers === 1) {
             const entry = game.roundSubmissions[0];
             game.answers.push({ word: entry.word, authorId: entry.playerId });
             game.currentBlankIndex++;
             game.roundSubmissions = [];
             if (game.currentBlankIndex >= game.template.blanks.length) game.status = 'finished';
        } else {
             game.phase = 'voting';
             const cpuWord = CPU_VOCAB[Math.floor(Math.random() * CPU_VOCAB.length)];
             game.roundSubmissions.push({ playerId: 'CPU', word: cpuWord });
             game.candidates = game.roundSubmissions.sort(() => Math.random() - 0.5);
             game.roundVotes = {};
        }
    }
    res.json({ success: true });
});

app.post('/api/vote', (req, res) => {
    const { roomCode, candidateIndex, playerId } = req.body;
    const game = games[roomCode];
    if (!game || game.phase !== 'voting') return res.status(400).json({ error: "Not voting" });

    game.roundVotes[playerId] = candidateIndex;
    if (Object.keys(game.roundVotes).length >= game.maxPlayers) {
        resolveRound(game);
    }
    res.json({ success: true });
});

function resolveRound(game) {
    const scores = new Array(game.candidates.length).fill(0);
    Object.values(game.roundVotes).forEach(index => { if (scores[index] !== undefined) scores[index]++; });
    let maxVotes = -1; let winningIndex = 0;
    scores.forEach((score, index) => { if (score > maxVotes) { maxVotes = score; winningIndex = index; } });
    const winningEntry = game.candidates[winningIndex];
    game.answers.push({ word: winningEntry.word, authorId: winningEntry.playerId });
    game.currentBlankIndex++;
    game.phase = 'writing';
    game.roundSubmissions = [];
    game.candidates = [];
    if (game.currentBlankIndex >= game.template.blanks.length) { game.status = 'finished'; }
}

function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(entry => {
        const authorName = entry.authorId === 'CPU' ? "🤖 Bot" : (game.names[entry.authorId] || "Unknown");
        // Styling matches Uppercase vibe
        const replacement = `<b>${entry.word} <span style="font-size:0.6em; color:#f1c40f;">(${authorName})</span></b>`;
        story = story.replace(/\{.*?\}/, replacement);
    });
    return story;
}

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
