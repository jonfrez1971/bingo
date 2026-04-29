// DB Simulation (Local Storage Backup)
const DB_KEY = 'bingo_db_v1';
const defaultSchema = { usuarios: [], rondas: [], participantes: [], sorteos: [], historialGanadores: [] };

function initDB() { if (!localStorage.getItem(DB_KEY)) localStorage.setItem(DB_KEY, JSON.stringify(defaultSchema)); }
function getTable(t) { initDB(); const d = JSON.parse(localStorage.getItem(DB_KEY)); return d[t] || []; }
function saveTable(t, data) { const d = JSON.parse(localStorage.getItem(DB_KEY)); d[t] = data; localStorage.setItem(DB_KEY, JSON.stringify(d)); }
function generateId(t, f) { const table = getTable(t); return table.length ? Math.max(...table.map(r => r[f])) + 1 : 1; }

const db = {
    createUser(nombre) { const table = getTable('usuarios'); const newUser = { user_id: generateId('usuarios', 'user_id'), nombre }; table.push(newUser); saveTable('usuarios', table); return newUser; },
    getAllUsers() { return getTable('usuarios'); },
    createRonda(acumulado) { const table = getTable('rondas'); const newRonda = { ronda_id: generateId('rondas', 'ronda_id'), acumulado }; table.push(newRonda); saveTable('rondas', table); return newRonda; },
    addParticipante(r, u, c) { const table = getTable('participantes'); const n = { participante_id: generateId('participantes', 'participante_id'), ronda_id: r, user_id: u, carton: c }; table.push(n); saveTable('participantes', table); return n; },
    getHistorialGanadores() { return getTable('historialGanadores'); }
};

// DOM Elements
const startBtn = document.getElementById('startBtn');
const clearPlayersBtn = document.getElementById('clearPlayersBtn');
const playersGrid = document.getElementById('playersGrid');
const playerNameInput = document.getElementById('playerNameInput');
const currentBallEl = document.getElementById('currentBall');
const jackpotDisplay = document.getElementById('jackpotDisplay');
const roundDisplay = document.getElementById('roundDisplay');
const bingoCage = document.getElementById('bingoCage');

// Global State
let players = [];
let drawnBalls = [];
let roundNumber = 1;
let jackpot = 10000;
let isRoundFinished = false;
let participants = [];
let winnerInfo = null;
let raffleWinnerIds = [];
let lastBallSpoken = 0;

const isPlayerMode = new URLSearchParams(window.location.search).get('mode') === 'player';

// Audio Context
let audioCtx;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES';
        u.rate = 0.9;
        window.speechSynthesis.speak(u);
    }
}

// Firebase Sync
function setupFirebaseSync() {
    if (!window.db_firebase) return;

    window.db_firebase.collection("jugadores").onSnapshot((snap) => {
        players = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPlayers();
    });

    window.db_firebase.collection("juego").doc("estado").onSnapshot((doc) => {
        if (doc.exists) {
            const d = doc.data();
            const newBalls = d.bolas || [];
            jackpot = d.jackpot || 10000;
            roundNumber = d.ronda || 1;
            winnerInfo = d.ganador || null;
            raffleWinnerIds = d.raffleWinnerIds || [];

            // Cantar la bola nueva si somos jugadores
            if (newBalls.length > drawnBalls.length) {
                const latestBall = newBalls[newBalls.length - 1];
                if (latestBall !== lastBallSpoken) {
                    speakText(latestBall.toString());
                    lastBallSpoken = latestBall;
                }
            }

            drawnBalls = newBalls;
            updateUI();
            updateMasterBoardUI();
            renderPlayers();

            if (winnerInfo && !isRoundFinished) {
                showWinnerOverlay(winnerInfo);
            }
        }
    });
}

function syncGameState(extra = {}) {
    if (!window.db_firebase || isPlayerMode) return;
    window.db_firebase.collection("juego").doc("estado").set({
        bolas: drawnBalls,
        jackpot: jackpot,
        ronda: roundNumber,
        ganador: winnerInfo,
        raffleWinnerIds: raffleWinnerIds,
        ...extra
    });
}

function updateMasterBoardUI() {
    for (let i = 1; i <= 90; i++) {
        const mc = document.getElementById(`master-cell-${i}`);
        if (mc) {
            if (drawnBalls.includes(i)) mc.classList.add('called');
            else mc.classList.remove('called');
        }
    }
}

function renderPlayers() {
    if (!playersGrid) return;
    playersGrid.innerHTML = '';
    const myName = localStorage.getItem('bingo_my_name');
    
    const title = document.getElementById('playersCountTitle');
    if (title) title.textContent = `Jugadores (${players.length})`;

    const sorted = [...players].sort((a,b) => (a.name === myName ? -1 : b.name === myName ? 1 : 0));

    sorted.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'player-card' + (p.name === myName ? ' my-card' : '');
        const carton = p.carton || [];
        let hits = 0;
        let nums = carton.length ? carton.map(n => {
            const m = drawnBalls.includes(n);
            if (m) hits++;
            return `<div class="number-capsule ${m ? 'marked' : ''}">${n}</div>`;
        }).join('') : '<div class="number-capsule">-</div>'.repeat(5);

        const isWinnerInRaffle = raffleWinnerIds.includes(p.name);
        const isPending = p.status === 'pendiente';

        card.innerHTML = `
            <div class="card-top">
                <span class="player-card-name" style="font-size:0.8rem;">
                    ${isWinnerInRaffle ? '🏆 ' : ''}${p.name === myName ? '⭐ ' : ''}${isPending ? '⏳ ' : ''}${p.name}
                </span>
                ${p.name === myName ? '<span style="font-size:0.5rem; color:var(--accent);">MI CARTÓN</span>' : ''}
                ${!isPlayerMode ? `<button onclick="removePlayer('${p.id}')" style="margin-left:auto; background:none; border:none; color:white; cursor:pointer;">🗑️</button>` : ''}
            </div>
            <div class="card-numbers">${nums}</div>
            <div class="progress-info"><span>Progreso</span><span>${hits}/5</span></div>
            <div class="progress-container"><div class="progress-bar" style="width:${(hits/5)*100}%"></div></div>
        `;
        playersGrid.appendChild(card);
    });
}

function addPlayer() {
    getAudioCtx();
    const name = playerNameInput.value.trim();
    if (!name) return alert("Escribe tu nombre.");
    if (players.length >= 30) return alert("Cupo lleno.");
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) return alert("Nombre existe.");

    localStorage.setItem('bingo_my_name', name);
    speakText(`Bienvenido ${name}. Completa tu pago.`);

    if (confirm(`¿Inscribir a ${name}?`)) {
        window.open("https://checkout.bold.co/payment/LNK_TYRW5PQ2S8", "_blank");
        window.db_firebase.collection("jugadores").add({
            name: name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'pendiente'
        });
        playerNameInput.value = '';
    }
}

function startNewRound() {
    if (isPlayerMode) return;
    if (players.length === 0) return alert("No hay jugadores.");
    startBtn.disabled = true;
    drawnBalls = [];
    isRoundFinished = false;
    winnerInfo = null;
    currentRound = db.createRonda(jackpot);
    roundNumber = currentRound.ronda_id;

    participants = [];
    players.forEach(pObj => {
        const carton = Array.from({length:5},()=>Math.floor(Math.random()*90)+1).sort((a,b)=>a-b);
        window.db_firebase.collection("jugadores").doc(pObj.id).update({ carton, status: 'jugando' });
        const user = db.createUser(pObj.name);
        const p = db.addParticipante(currentRound.ronda_id, user.user_id, carton);
        participants.push({...p, name: user.nombre, cardId: pObj.id});
    });

    const selected = [...participants].sort(()=>0.5-Math.random()).slice(0, 2);
    raffleWinnerIds = selected.map(p => p.name);
    syncGameState();

    speakText("Sorteando acumulado. Atentos todos.");

    const rOverlay = document.getElementById('raffleOverlay');
    if (rOverlay) rOverlay.classList.add('active');
    setTimeout(() => {
        if (rOverlay) rOverlay.classList.remove('active');
        spinCageAndDraw();
    }, 5000);
}

function spinCageAndDraw() {
    if (isRoundFinished || drawnBalls.length >= 90) return;
    if (bingoCage) bingoCage.classList.add('spinning');
    setTimeout(() => {
        if (bingoCage) bingoCage.classList.remove('spinning');
        drawBall();
    }, 2000);
}

function drawBall() {
    if (isRoundFinished || isPlayerMode) return;
    let ball;
    do { ball = Math.floor(Math.random()*90)+1; } while (drawnBalls.includes(ball));
    drawnBalls.push(ball);
    syncGameState();
    
    speakText(ball.toString());
    checkWinners();
    if (!isRoundFinished) setTimeout(spinCageAndDraw, 4500);
}

function checkWinners() {
    if (isPlayerMode) return;
    const base = (players.length * 4000) * 0.7;
    participants.forEach(p => {
        const hits = p.carton.filter(n => drawnBalls.includes(n)).length;
        if (hits === 5 && !isRoundFinished) {
            isRoundFinished = true;
            const wonJackpot = raffleWinnerIds.includes(p.name);
            winnerInfo = { name: p.name, prize: wonJackpot ? (base + jackpot) : base };
            syncGameState();
            showWinnerOverlay(winnerInfo);
        }
    });
}

function showWinnerOverlay(info) {
    isRoundFinished = true;
    const wOverlay = document.getElementById('winnerOverlay');
    const wName = document.getElementById('winnerName');
    const wPrize = document.getElementById('winnerPrize');
    if (wName) wName.textContent = info.name;
    if (wPrize) wPrize.textContent = `Premio: $${info.prize.toLocaleString()}`;
    if (wOverlay) wOverlay.classList.add('active');
    speakText(`¡Bingo! Ganador ${info.name}.`);
}

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = '#' + roundNumber;
    if (drawnBalls.length > 0) {
        currentBallEl.textContent = drawnBalls[drawnBalls.length - 1];
        currentBallEl.style.opacity = 1;
    }
}

function init() {
    if (isPlayerMode) {
        const sBtn = document.getElementById('startBtn');
        const cBtn = document.getElementById('clearPlayersBtn');
        if (sBtn) sBtn.style.display = 'none';
        if (cBtn) cBtn.style.display = 'none';
    }

    startBtn?.addEventListener('click', () => { getAudioCtx(); startNewRound(); });
    document.getElementById('addPlayerBtn')?.addEventListener('click', () => { getAudioCtx(); addPlayer(); });
    
    document.getElementById('nextRoundBtn')?.addEventListener('click', () => {
        const overlay = document.getElementById('winnerOverlay');
        if (overlay) overlay.classList.remove('active');
        isRoundFinished = false;
        if (!isPlayerMode) {
            winnerInfo = null; drawnBalls = [];
            syncGameState();
            startBtn.disabled = false;
        }
    });

    setupFirebaseSync();
    const mb = document.getElementById('masterBoard');
    if (mb) { mb.innerHTML = ''; for(let i=1; i<=90; i++) mb.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`; }
}

window.addEventListener('DOMContentLoaded', init);
