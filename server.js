const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
// --- FIREBASE SETUP ---
const admin = require('firebase-admin');

// Load the secret key we uploaded to Render
try {
    const serviceAccount = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("🔥 Firebase Connected!");
} catch (e) {
    console.error("❌ Failed to connect to Firebase. Did you upload firebase-key.json to Render?", e);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

// --- TEMPLATES ---
let TEMPLATES = {};
try {
    const data = fs.readFileSync('templates.json', 'utf8');
    TEMPLATES = JSON.parse(data);
} catch (err) {
    console.log("No templates.json found, using empty defaults.");
    TEMPLATES = { sfw: [], nsfw: [] }; 
}

const CPU_VOCAB = ["SPATULA", "MOIST", "GRANDMA", "EXPLOSION", "SLIPPERY", "BANANA", "SLIME", "AWKWARD", "SHINY", "WIGGLY"];

function generateId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- API ENDPOINTS ---

app.post('/api/create', async (req, res) => {
    const { mode, playerId, playerName, maxPlayers } = req.body;
    const roomCode = generateId();
    const category = (mode === 'nsfw' && TEMPLATES.nsfw) ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
    if (!category || category.length === 0) return res.json({ success: false, error: "No templates!" });

    const isSinglePlayer = parseInt(maxPlayers) === 1;

    const newGame = {
        id: roomCode,
        mode: mode,
        template: category[Math.floor(Math.random() * category.length)],
        maxPlayers: parseInt(maxPlayers) || 2,
        players: [playerId],
        names: { [playerId]: playerName || "You" },
        hostId: playerId,
        currentBlankIndex: 0,
        status: 'playing',
        phase: isSinglePlayer ? 'writing' : 'lobby',
        answers: [],            
        roundSubmissions: [],   
        roundVotes: {},         
        candidates: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp() // Auto-delete old games later if we want
    };

    // SAVE TO FIREBASE
    await db.collection('games').doc(roomCode).set(newGame);

    res.json({ roomCode, success: true });
});

app.post('/api/join', async (req, res) => {
    const { roomCode, playerId, playerName } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    const doc = await gameRef.get();

    if (!doc.exists) return res.json({ success: false, error: "Game not found" });
    let game = doc.data();

    // Logic: Add player
    if (!game.players.includes(playerId)) {
        game.players.push(playerId);
        if (playerName) game.names[playerId] = playerName;
        
        // Auto-start check
        if (game.phase === 'lobby' && game.players.length >= game.maxPlayers) {
            game.phase = 'writing';
        }
        
        // Update DB
        await gameRef.update({
            players: game.players,
            names: game.names,
            phase: game.phase
        });
    }

    res.json({ success: true });
});

app.post('/api/start', async (req, res) => {
    const { roomCode } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    // Force start
    await gameRef.update({
        phase: 'writing'
    });
    res.json({ success: true });
});

app.post('/api/replay', async (req, res) => {
    const { roomCode } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    const doc = await gameRef.get();
    if (!doc.exists) return res.json({ success: false });
    
    const game = doc.data();
    const category = game.mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
    // Reset Logic
    await gameRef.update({
        template: category[Math.floor(Math.random() * category.length)],
        currentBlankIndex: 0,
        status: 'playing',
        phase: 'writing',
        answers: [],
        roundSubmissions: [],
        roundVotes: {},
        candidates: []
    });

    res.json({ success: true });
});

app.get('/api/game/:code', async (req, res) => {
    const gameRef = db.collection('games').doc(req.params.code);
    const doc = await gameRef.get();

    if (!doc.exists) return res.status(404).json({ error: "Game not found" });
    const game = doc.data();
    
    const playerId = req.query.playerId;
    const hasSubmitted = game.roundSubmissions ? game.roundSubmissions.some(s => s.playerId === playerId) : false;
    const hasVoted = game.roundVotes ? (game.roundVotes[playerId] !== undefined) : false;

    // Send data to client
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
        
        submittedCount: game.roundSubmissions ? game.roundSubmissions.length : 0,
        hasSubmitted: hasSubmitted,
        candidates: (game.phase === 'voting' && game.candidates) ? game.candidates.map(c => c.word) : [],
        hasVoted: hasVoted,
        voteCount: game.roundVotes ? Object.keys(game.roundVotes).length : 0
    });
});

app.post('/api/submit', async (req, res) => {
    let { roomCode, word, playerId } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    
    // We use a "Transaction" to prevent race conditions (two people submitting at exact same time)
    await db.runTransaction(async (t) => {
        const doc = await t.get(gameRef);
        if (!doc.exists) throw "Game not found";
        let game = doc.data();

        if (game.phase !== 'writing') return;
        if (game.roundSubmissions.some(s => s.playerId === playerId)) return;

        // Add Submission
        word = word.trim().toUpperCase();
        game.roundSubmissions.push({ playerId, word });

        // Check Round End
        if (game.roundSubmissions.length >= game.maxPlayers) {
            if (game.maxPlayers === 1) {
                 // Single Player
                 const entry = game.roundSubmissions[0];
                 game.answers.push({ word: entry.word, authorId: entry.playerId });
                 game.currentBlankIndex++;
                 game.roundSubmissions = [];
                 if (game.currentBlankIndex >= game.template.blanks.length) game.status = 'finished';
            } else {
                 // Multiplayer
                 game.phase = 'voting';
                 const cpuWord = CPU_VOCAB[Math.floor(Math.random() * CPU_VOCAB.length)];
                 game.roundSubmissions.push({ playerId: 'CPU', word: cpuWord });
                 game.candidates = game.roundSubmissions.sort(() => Math.random() - 0.5);
                 game.roundVotes = {};
            }
        }
        
        t.update(gameRef, game);
    });

    res.json({ success: true });
});

app.post('/api/vote', async (req, res) => {
    const { roomCode, candidateIndex, playerId } = req.body;
    const gameRef = db.collection('games').doc(roomCode);

    await db.runTransaction(async (t) => {
        const doc = await t.get(gameRef);
        if (!doc.exists) throw "Game not found";
        let game = doc.data();

        if (game.phase !== 'voting') return;
        
        // Record Vote
        // (If roundVotes doesn't exist yet, init it)
        if (!game.roundVotes) game.roundVotes = {};
        game.roundVotes[playerId] = candidateIndex;

        // Check Vote End
        if (Object.keys(game.roundVotes).length >= game.maxPlayers) {
            // Tally
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
            game.roundVotes = {}; // Clear votes
            
            if (game.currentBlankIndex >= game.template.blanks.length) { game.status = 'finished'; }
        }

        t.update(gameRef, game);
    });

    res.json({ success: true });
});

function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(entry => {
        const authorName = entry.authorId === 'CPU' ? "🤖 Bot" : (game.names[entry.authorId] || "Unknown");
        const replacement = `<b>${entry.word} <span style="font-size:0.6em; color:#f1c40f;">(${authorName})</span></b>`;
        story = story.replace(/\{.*?\}/, replacement);
    });
    return story;
}

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
