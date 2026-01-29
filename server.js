const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

const games = {}; // Stores all active games

const TEMPLATES = {
    sfw: [
        { title: "The Bakery", text: "I bought a {adjective} {noun}. The baker told me to {verb} away.", blanks: ["adjective", "noun", "verb"] }
    ],
    nsfw: [
        { title: "Date Night", text: "My date pulled out a {adjective} {noun}. I immediately {verb}.", blanks: ["adjective", "noun", "verb"] }
    ]
};

function generateId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- API ---

// 1. Create Game
app.post('/api/create', (req, res) => {
    const { mode, playerId } = req.body;
    const roomCode = generateId();
    const category = mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
    games[roomCode] = {
        id: roomCode,
        mode: mode,
        template: category[Math.floor(Math.random() * category.length)],
        currentBlankIndex: 0,
        answers: [],
        status: 'playing',
        players: [playerId], // Add creator to player list
        turnIndex: 0         // Index of which player goes next
    };

    res.json({ roomCode, success: true });
});

// 2. Join Game
app.post('/api/join', (req, res) => {
    const { roomCode, playerId } = req.body;
    const game = games[roomCode];

    if (!game) return res.json({ success: false, error: "Game not found" });

    // If player isn't already in the list, add them
    if (!game.players.includes(playerId)) {
        game.players.push(playerId);
    }
    
    res.json({ success: true });
});

// 3. Get Game State
app.get('/api/game/:code', (req, res) => {
    const game = games[req.params.code];
    if (!game) return res.status(404).json({ error: "Game not found" });
    
    // Calculate whose turn it is
    const currentPlayerId = game.players[game.turnIndex % game.players.length];

    res.json({
        status: game.status,
        currentBlank: game.template.blanks[game.currentBlankIndex],
        progress: game.currentBlankIndex,
        totalBlanks: game.template.blanks.length,
        completedText: game.status === 'finished' ? compileStory(game) : null,
        // Send turn info to frontend
        currentPlayerId: currentPlayerId,
        playerCount: game.players.length
    });
});

// 4. Submit Word (With Turn Checking)
app.post('/api/submit', (req, res) => {
    const { roomCode, word, playerId } = req.body;
    const game = games[roomCode];

    if (!game || game.status !== 'playing') return res.status(400).json({ error: "Invalid" });

    // CHECK: Is it actually this player's turn?
    const validPlayerId = game.players[game.turnIndex % game.players.length];
    if (playerId !== validPlayerId) {
        return res.json({ success: false, error: "Not your turn!" });
    }

    // Accept the word
    game.answers.push(word);
    game.currentBlankIndex++;
    game.turnIndex++; // Pass turn to next person

    if (game.currentBlankIndex >= game.template.blanks.length) {
        game.status = 'finished';
    }

    res.json({ success: true });
});

function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(a => story = story.replace(/\{.*?\}/, `<b>${a}</b>`));
    return story;
}

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
