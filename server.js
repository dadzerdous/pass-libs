const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

const games = {};

const TEMPLATES = {
    sfw: [
        { title: "The Bakery", text: "I bought a {adjective} {noun}. The baker told me to {verb} away.", blanks: ["adjective", "noun", "verb"] },
        { title: "Zoo Trip", text: "The {animal} was looking very {adjective} today.", blanks: ["animal", "adjective"] }
    ],
    nsfw: [
        { title: "Date Night", text: "My date pulled out a {adjective} {noun}. I immediately {verb}.", blanks: ["adjective", "noun", "verb"] }
    ]
};

function generateId() { return Math.random().toString(36).substring(2, 6).toUpperCase(); }

// --- API ---

app.post('/api/create', (req, res) => {
    const { mode, playerId, playerName, maxPlayers } = req.body;
    const roomCode = generateId();
    const category = mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    
    games[roomCode] = {
        id: roomCode,
        mode: mode,
        template: category[Math.floor(Math.random() * category.length)],
        maxPlayers: parseInt(maxPlayers) || 2,
        players: [playerId],
        names: { [playerId]: playerName }, // MAP ID TO NAME
        
        currentBlankIndex: 0,
        status: 'playing',
        answers: [],            
        roundSubmissions: []    
    };

    res.json({ roomCode, success: true });
});

app.post('/api/join', (req, res) => {
    const { roomCode, playerId, playerName } = req.body;
    const game = games[roomCode];
    if (!game) return res.json({ success: false, error: "Game not found" });

    if (!game.players.includes(playerId)) {
        game.players.push(playerId);
        // If they provide a name, save it. If they are re-joining, keep old name.
        if (playerName) {
            game.names[playerId] = playerName;
        }
    }
    res.json({ success: true });
});

app.get('/api/game/:code', (req, res) => {
    const game = games[req.params.code];
    if (!game) return res.status(404).json({ error: "Game not found" });
    
    const playerId = req.query.playerId;
    const hasSubmitted = game.roundSubmissions.some(s => s.playerId === playerId);

    res.json({
        status: game.status,
        currentBlank: game.template.blanks[game.currentBlankIndex],
        progress: game.currentBlankIndex,
        totalBlanks: game.template.blanks.length,
        completedText: game.status === 'finished' ? compileStory(game) : null,
        
        connectedPlayers: game.players.length,
        maxPlayers: game.maxPlayers,
        submittedCount: game.roundSubmissions.length,
        hasSubmitted: hasSubmitted
    });
});

app.post('/api/submit', (req, res) => {
    const { roomCode, word, playerId } = req.body;
    const game = games[roomCode];

    if (!game || game.status !== 'playing') return res.status(400).json({ error: "Invalid" });

    if (game.roundSubmissions.some(s => s.playerId === playerId)) {
        return res.json({ success: false, error: "Already submitted" });
    }

    game.roundSubmissions.push({ playerId, word });

    if (game.roundSubmissions.length >= game.maxPlayers) {
        // Pick Winner
        const winner = game.roundSubmissions[Math.floor(Math.random() * game.roundSubmissions.length)];
        
        // SAVE WORD + AUTHOR ID
        game.answers.push({ word: winner.word, authorId: winner.playerId });
        
        game.roundSubmissions = [];
        game.currentBlankIndex++;

        if (game.currentBlankIndex >= game.template.blanks.length) {
            game.status = 'finished';
        }
    }

    res.json({ success: true });
});

function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(entry => {
        const authorName = game.names[entry.authorId] || "Unknown";
        // Create the HTML: "Word (Name)"
        const replacement = `<b>${entry.word} <span style="font-size:0.6em; color:#f1c40f;">(${authorName})</span></b>`;
        story = story.replace(/\{.*?\}/, replacement);
    });
    return story;
}

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
