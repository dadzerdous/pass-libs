const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
// --- FIREBASE SETUP ---
const admin = require('firebase-admin');

// Load the secret key we uploaded to Render
try {
    if (fs.existsSync('./firebase-key.json')) {
        const serviceAccount = JSON.parse(fs.readFileSync('./firebase-key.json', 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("🔥 Firebase Connected!");
    } else {
        console.log("⚠️ No firebase-key.json found! Games will not save.");
    }
} catch (e) {
    console.error("❌ Firebase Error:", e);
}

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static(__dirname));


// --- LOAD BAD WORDS ---
let BAD_WORDS = [];
try {
    const data = fs.readFileSync('badwords.json', 'utf8');
    BAD_WORDS = JSON.parse(data);
    // Normalize to uppercase just in case
    BAD_WORDS = BAD_WORDS.map(w => w.toUpperCase());
    console.log(`🤬 Loaded ${BAD_WORDS.length} bad words.`);
} catch (err) {
    console.log("⚠️ No badwords.json found. Filter is empty.");
    BAD_WORDS = []; 
}
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
    const { mode, playerId, playerName, maxPlayers, isPublic } = req.body;
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
        isPublic: !!isPublic,
        
        currentBlankIndex: 0,
        status: 'playing',
        phase: isSinglePlayer ? 'writing' : 'lobby',
        answers: [],            
        roundSubmissions: [],   
        roundVotes: {},         
        candidates: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('games').doc(roomCode).set(newGame);

    res.json({ roomCode, success: true });
});

app.get('/api/list', async (req, res) => {
    try {
        const snapshot = await db.collection('games')
            .where('isPublic', '==', true)
            .where('phase', '==', 'lobby')
            .limit(10)
            .get();

        const gamesList = [];
        snapshot.forEach(doc => {
            const g = doc.data();
            if (g.players.length < g.maxPlayers) {
                gamesList.push({
                    roomCode: g.id,
                    mode: g.mode,
                    playerCount: g.players.length,
                    maxPlayers: g.maxPlayers,
                    hostName: g.names[g.hostId] || "Unknown"
                });
            }
        });

        res.json({ success: true, games: gamesList });
    } catch (e) {
        console.error("List Error:", e);
        res.json({ success: false, error: "Could not fetch games" });
    }
});

app.post('/api/join', async (req, res) => {
    const { roomCode, playerId, playerName } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    const doc = await gameRef.get();

    if (!doc.exists) return res.json({ success: false, error: "Game not found" });
    let game = doc.data();

    // Rejoin Logic: If player is already in list, just say success
    if (game.players.includes(playerId)) {
        return res.json({ success: true, rejoined: true });
    }

    // New Join Logic
    if (game.phase === 'lobby' && game.players.length < game.maxPlayers) {
        game.players.push(playerId);
        if (playerName) game.names[playerId] = playerName;
        
        if (game.players.length >= game.maxPlayers) {
            game.phase = 'writing';
        }
        
        await gameRef.update({
            players: game.players,
            names: game.names,
            phase: game.phase
        });
        return res.json({ success: true });
    }
    
    res.json({ success: false, error: "Room full or started" });
});
// --- NEW: Leave / Cancel Endpoint ---
app.post('/api/leave', async (req, res) => {
    const { roomCode, playerId } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    
    await db.runTransaction(async (t) => {
        const doc = await t.get(gameRef);
        if (!doc.exists) return; // Already gone
        const game = doc.data();

        // SCENARIO 1: Host Leaves in Lobby -> DESTROY GAME
        if (game.phase === 'lobby' && game.hostId === playerId) {
            t.delete(gameRef); // Delete the room entirely
        }
        // SCENARIO 2: Player Leaves in Lobby -> REMOVE PLAYER
        else if (game.phase === 'lobby') {
            const newPlayers = game.players.filter(p => p !== playerId);
            const newNames = { ...game.names };
            delete newNames[playerId];
            t.update(gameRef, { players: newPlayers, names: newNames });
        }
        // SCENARIO 3: Game in Progress -> DO NOTHING (Allow Rejoin)
        else {
            // We don't remove them so they can refresh/rejoin
        }
    });

    res.json({ success: true });
});

// --- NEW: Auto-Cleanup (The Janitor) ---
// Runs every hour to delete games older than 24 hours
setInterval(async () => {
    console.log("🧹 Running Cleanup...");
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    // Note: This requires a Firestore Index (Render logs will tell you the URL to create it)
    try {
        const snapshot = await db.collection('games')
            .where('createdAt', '<', admin.firestore.Timestamp.fromDate(yesterday))
            .get();
        
        if (snapshot.empty) return;
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        console.log(`🗑️ Deleted ${snapshot.size} old games.`);
    } catch (e) {
        console.log("Cleanup skipped (Index likely building):", e.message);
    }
}, 60 * 60 * 1000); // Run every 60 mins
app.post('/api/start', async (req, res) => {
    const { roomCode } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    await gameRef.update({ phase: 'writing' });
    res.json({ success: true });
});

app.post('/api/replay', async (req, res) => {
    const { roomCode } = req.body;
    const gameRef = db.collection('games').doc(roomCode);
    const doc = await gameRef.get();
    if (!doc.exists) return res.json({ success: false });
    
    const game = doc.data();
    const category = game.mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
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

    // Generate Masked Story (For Context Mode)
    let maskedStory = game.template.text;
    // 1. Fill in past answers
    game.answers.forEach(a => {
        maskedStory = maskedStory.replace(/\{.*?\}/, `<b>${a.word}</b>`);
    });
    // 2. Mask future blanks
    maskedStory = maskedStory.replace(/\{.*?\}/g, "_______");

    res.json({
        status: game.status,
        phase: game.phase,
        currentBlank: game.template.blanks[game.currentBlankIndex],
        progress: game.currentBlankIndex,
        totalBlanks: game.template.blanks.length,
        completedText: game.status === 'finished' ? compileStory(game) : null,
        maskedStory: maskedStory, // <--- NEW: Send the partial story
        
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
    
    await db.runTransaction(async (t) => {
        const doc = await t.get(gameRef);
        if (!doc.exists) throw "Game not found";
        let game = doc.data();

        if (game.phase !== 'writing') return;
        if (game.roundSubmissions.some(s => s.playerId === playerId)) return;

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
        
        if (!game.roundVotes) game.roundVotes = {};
        game.roundVotes[playerId] = candidateIndex;

        if (Object.keys(game.roundVotes).length >= game.maxPlayers) {
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
            game.roundVotes = {}; 
            
            if (game.currentBlankIndex >= game.template.blanks.length) { game.status = 'finished'; }
        }

        t.update(gameRef, game);
    });

    res.json({ success: true });
});

// COLOR FIX: Changed #f1c40f (Yellow) to #8e44ad (Purple)
function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(entry => {
        const authorName = entry.authorId === 'CPU' ? "🤖 Bot" : (game.names[entry.authorId] || "Unknown");
        // FIXED: Changed 0.6em to 70% to avoid the "Reader Mode" splitting bug
        const replacement = `<b>${entry.word} <span style="font-size:70%; color:#8e44ad;">(${authorName})</span></b>`;
        story = story.replace(/\{.*?\}/, replacement);
    });
    return story;
}

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
