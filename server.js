const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Serves the frontend

// --- DATA STORAGE (In-Memory for MVP) ---
const games = {};

// --- TEMPLATES ---
const TEMPLATES = {
    sfw: [
        {
            title: "The Bakery",
            text: "I went to the bakery to buy a {adjective} {noun}. The baker told me to {verb} away.",
            blanks: ["adjective", "noun", "verb"]
        },
        {
            title: "The Zoo",
            text: "The {animal} at the zoo was very {adjective}. It loved to eat {food}.",
            blanks: ["animal", "adjective", "food"]
        }
    ],
    nsfw: [
        {
            title: "Date Night",
            text: "My date was going well until they pulled out a {adjective} {noun}. I immediately {verb}.",
            blanks: ["adjective", "noun", "verb"] // 18+ Context
        }
    ]
};

// --- HELPER FUNCTIONS ---
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// --- API ENDPOINTS ---

// 1. Create a Game
app.post('/api/create', (req, res) => {
    const { mode } = req.body; // 'sfw' or 'nsfw'
    const roomCode = generateRoomCode();
    
    // Select a random template based on mode
    const category = mode === 'nsfw' ? TEMPLATES.nsfw : TEMPLATES.sfw;
    const selectedTemplate = category[Math.floor(Math.random() * category.length)];

    games[roomCode] = {
        id: roomCode,
        mode: mode,
        template: selectedTemplate,
        currentBlankIndex: 0,
        answers: [],
        status: 'playing', // 'playing' or 'finished'
        history: [] // Log of who did what
    };

    res.json({ roomCode, success: true });
});

// 2. Get Game State (Polling)
app.get('/api/game/:code', (req, res) => {
    const game = games[req.params.code];
    if (!game) {
        return res.status(404).json({ error: "Game not found" });
    }
    
    // Logic to show just the current blank
    const currentBlank = game.template.blanks[game.currentBlankIndex];
    
    res.json({
        status: game.status,
        currentBlank: currentBlank,
        totalBlanks: game.template.blanks.length,
        progress: game.currentBlankIndex,
        completedText: game.status === 'finished' ? compileStory(game) : null
    });
});

// 3. Submit Word
app.post('/api/submit', (req, res) => {
    const { roomCode, word } = req.body;
    const game = games[roomCode];

    if (!game || game.status !== 'playing') {
        return res.status(400).json({ error: "Invalid move" });
    }

    // Save answer
    game.answers.push(word);
    game.currentBlankIndex++;

    // Check if finished
    if (game.currentBlankIndex >= game.template.blanks.length) {
        game.status = 'finished';
    }

    res.json({ success: true });
});

// --- STORY COMPILER ---
function compileStory(game) {
    let story = game.template.text;
    game.answers.forEach(answer => {
        // Simple replace for the first occurring brace set
        // Note: Real production code needs a more robust regex, 
        // but this works for sequential simple replacements
        story = story.replace(/\{.*?\}/, `<b>${answer}</b>`);
    });
    return story;
}

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Pass-Libs server running on port ${PORT}`);
});
