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

// Simple bot answers to blend in
const CPU_VOCAB = [
    "spatula", "moist", "grandma", "explosion", "slippery", 
    "banana", "slime", "awkward", "shiny", "wiggly"
];

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
        names: { [playerId]: playerName },
        
        currentBlankIndex: 0,
        status: 'playing',
        phase: 'writing',       // 'writing' OR 'voting'
        
        answers: [],            // Final locked-in words
        roundSubmissions: [],   // Words submitted this round
        roundVotes: {},         // Votes cast this round { playerId: candidateIndex }
        candidates: []          // The shuffled list of options to vote on
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
        
        // WRITING PHASE DATA
        submittedCount: game.roundSubmissions.length,
        hasSubmitted: hasSubmitted,

        // VOTING PHASE DATA
        candidates: game.phase === 'voting' ? game.candidates.map(c => c.word) : [],
        hasVoted: hasVoted,
        voteCount: Object.keys(game.roundVotes).length
    });
});

app.post('/api/submit', (req, res) => {
    const { roomCode, word, playerId } = req.body;
    const game = games[roomCode];

    if (!game || game.status !== 'playing' || game.phase !== 'writing') {
        return res.status(400).json({ error: "Invalid" });
    }

    if (game.roundSubmissions.some(s => s.playerId === playerId)) {
        return res.json({ success: false, error: "Already submitted" });
    }

    game.roundSubmissions.push({ playerId, word });

    // IF ALL SUBMITTED -> SWITCH TO VOTING
    if (game.roundSubmissions.length >= game.maxPlayers) {
        startVotingPhase(game);
    }

    res.json({ success: true });
});

app.post('/api/vote', (req, res) => {
    const { roomCode, candidateIndex, playerId } = req.body;
    const game = games[roomCode];

    if (!game || game.phase !== 'voting') return res.status(400).json({ error: "Not voting" });

    game.roundVotes[playerId] = candidateIndex;

    // IF ALL VOTED -> COUNT VOTES & ADVANCE
    if (Object.keys(game.roundVotes).length >= game.maxPlayers) {
        resolveRound(game);
    }

    res.json({ success: true });
});

function startVotingPhase(game) {
    game.phase = 'voting';
    
    // 1. Add CPU Answer
    const cpuWord = CPU_VOCAB[Math.floor(Math.random() * CPU_VOCAB.length)];
    game.roundSubmissions.push({ playerId: 'CPU', word: cpuWord });

    // 2. Shuffle candidates
    // We store them as objects { word: "X", author: "Y" } but send only "X" to client
    game.candidates = game.roundSubmissions.sort(() => Math.random() - 0.5);
    
    game.roundVotes = {}; // Reset votes
}

function resolveRound(game) {
    // 1. Tally Votes
    const scores = new Array(game.candidates.length).fill(0);
    Object.values(game.roundVotes).forEach(index => {
        if (scores[index] !== undefined) scores[index]++;
    });

    // 2. Find Winner (Highest Score)
    let maxVotes = -1;
    let winningIndex = 0;
    scores.forEach((score, index) => {
        if (score > maxVotes) {
            maxVotes = score;
            winningIndex = index;
        }
    });

    const winningEntry = game.candidates[winningIndex];

    // 3. Save to Story
    game.answers.push({ 
        word: winningEntry.word, 
        authorId: winningEntry.playerId 
    });

    // 4. Reset for next round
    game.currentBlankIndex++;
    game.phase = 'writing';
    game.roundSubmissions = [];
    game.candidates = [];
    
    if (game.currentBlankIndex >= game.template.blanks.length) {
        game.status = 'finished';
    }
}

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
