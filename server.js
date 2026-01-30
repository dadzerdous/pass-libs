// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

/* ------------------------------
   In-memory game store
-------------------------------- */
const games = {};

/* ------------------------------
   Templates
-------------------------------- */
const TEMPLATES = {
    sfw: [
        {
            title: "The Bakery",
            text: "I bought a {adjective} {noun}. The baker told me to {verb} away.",
            blanks: ["adjective", "noun", "verb"]
        },
        {
            title: "Zoo Trip",
            text: "The {animal} was looking very {adjective} today.",
            blanks: ["animal", "adjective"]
        }
    ],
    nsfw: [
        {
            title: "Date Night",
            text: "My date pulled out a {adjective} {noun}. I immediately {verb}.",
            blanks: ["adjective", "noun", "verb"]
        }
    ]
};

/* ------------------------------
   Helpers
-------------------------------- */
function generateId() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(a => {
        story = story.replace(/\{.*?\}/, `<b>${a}</b>`);
    });
    return story;
}

/* ------------------------------
   API: CREATE GAME
-------------------------------- */
app.post('/api/create', (req, res) => {
    const { mode, playerId, maxPlayers } = req.body;
    const roomCode = generateId();

    const category = mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    const template = category[Math.floor(Math.random() * category.length)];

    games[roomCode] = {
        id: roomCode,
        mode,
        template,
        maxPlayers: parseInt(maxPlayers) || 2,
        players: [playerId],

        status: 'playing',
        phase: 'submit',          // submit | reveal | finished
        revealUntil: null,

        currentBlankIndex: 0,
        answers: [],
        roundSubmissions: []
    };

    res.json({ success: true, roomCode });
});

/* ------------------------------
   API: JOIN GAME
-------------------------------- */
app.post('/api/join', (req, res) => {
    const { roomCode, playerId } = req.body;
    const game = games[roomCode];

    if (!game) {
        return res.json({ success: false, error: "Game not found" });
    }

    if (!game.players.includes(playerId)) {
        game.players.push(playerId);
    }

    res.json({ success: true });
});

/* ------------------------------
   API: GAME STATE (POLL)
-------------------------------- */
app.get('/api/game/:code', (req, res) => {
    const game = games[req.params.code];
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }

    const playerId = req.query.playerId;
    const hasSubmitted = game.roundSubmissions.some(
        s => s.playerId === playerId
    );

    // 🔥 RESOLVE REVEAL PHASE HERE
    if (game.phase === 'reveal' && Date.now() > game.revealUntil) {
        const winner =
            game.roundSubmissions[
                Math.floor(Math.random() * game.roundSubmissions.length)
            ];

        game.answers.push(winner.word);
        game.roundSubmissions = [];
        game.currentBlankIndex++;
        game.revealUntil = null;
        game.phase = 'submit';

        if (game.currentBlankIndex >= game.template.blanks.length) {
            game.status = 'finished';
            game.phase = 'finished';
        }
    }

    res.json({
        status: game.status,
        phase: game.phase,

        currentBlank: game.template.blanks[game.currentBlankIndex],
        progress: game.currentBlankIndex,
        totalBlanks: game.template.blanks.length,

        completedText:
            game.status === 'finished' ? compileStory(game) : null,

        connectedPlayers: game.players.length,
        maxPlayers: game.maxPlayers,
        submittedCount: game.roundSubmissions.length,
        hasSubmitted,

        submissions: game.roundSubmissions.map(s => s.word)
    });
});

/* ------------------------------
   API: SUBMIT WORD
-------------------------------- */
app.post('/api/submit', (req, res) => {
    const { roomCode, word, playerId } = req.body;
    const game = games[roomCode];

    if (!game || game.status !== 'playing' || game.phase !== 'submit') {
        return res.status(400).json({ success: false });
    }

    if (game.roundSubmissions.some(s => s.playerId === playerId)) {
        return res.json({ success: false, error: "Already submitted" });
    }

    game.roundSubmissions.push({ playerId, word });

    // 🔥 MOVE TO REVEAL PHASE
    if (game.roundSubmissions.length >= game.maxPlayers) {
        game.phase = 'reveal';
        game.revealUntil = Date.now() + 4000; // 4 seconds to laugh
    }

    res.json({ success: true });
});

/* ------------------------------
   START SERVER
-------------------------------- */
app.listen(PORT, () => {
    console.log(`Pass-Libs server running on port ${PORT}`);
});
