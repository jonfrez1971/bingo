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

const isPlayerMode = new URLSearchParams(window.location.search).get('mode') === 'player';

// Audio Context
let audioCtx;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

function playMixingSound(durationMs) {
    const ctx = getAudioCtx();
    const startTime = ctx.currentTime;
    const duration = durationMs / 1000;
    
    // Un simple sonido de mezcla procesal
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, startTime);
    g.gain.setValueAtTime(0.05, startTime);
    g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(startTime); osc.stop(startTime + duration);
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
            drawnBalls = d.bolas || [];
            jackpot = d.jackpot || 10000;
            roundNumber = d.ronda || 1;
            winnerInfo = d.ganador || null;

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
    playersGrid.innerHTML = '';
    const myName = localStorage.getItem('bingo_my_name');
    players.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'player-card' + (p.name === myName ? ' my-card' : '');
        const carton = p.carton || [];
        let hits = 0;
        let nums = carton.length ? carton.map(n => {
            const m = drawnBalls.includes(n);
            if (m) hits++;
            return `<div class="number-capsule ${m ? 'marked' : ''}">${n}</div>`;
        }).join('') : '<div class="number-capsule">-</div>'.repeat(5);

        card.innerHTML = `
            <div class="card-top">
                <span>${p.name === myName ? '⭐ ' : ''}${p.name}</span>
                <button onclick="removePlayer('${p.id}')" style="margin-left:auto; background:none; border:none; color:white; cursor:pointer;">🗑️</button>
            </div>
            <div class="card-numbers">${nums}</div>
            <div style="font-size:0.7rem; margin-top:5px;">Progreso: ${hits}/5</div>
        `;
        playersGrid.appendChild(card);
    });
}

function startNewRound() {
    if (players.length === 0) return alert("No hay jugadores");
    startBtn.disabled = true;
    drawnBalls = [];
    isRoundFinished = false;
    winnerInfo = null;
    currentRound = db.createRonda(jackpot);
    roundNumber = currentRound.ronda_id;
    syncGameState();

    participants = [];
    players.forEach(pObj => {
        const carton = Array.from({length:5},()=>Math.floor(Math.random()*90)+1).sort((a,b)=>a-b);
        window.db_firebase.collection("jugadores").doc(pObj.id).update({ carton, status: 'jugando' });
        const user = db.createUser(pObj.name);
        const p = db.addParticipante(currentRound.ronda_id, user.user_id, carton);
        participants.push({...p, name: user.nombre, cardId: pObj.id});
    });

    // Sorteo Acumulado
    const selected = [...participants].sort(()=>0.5-Math.random()).slice(0,2);
    const names = selected.map(p=>p.name).join(' y ');
    const raffleEl = document.getElementById('raffleName');
    if (raffleEl) raffleEl.textContent = names;
    
    if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Sorteando acumulado. Atentos ${names}.`));
    }

    const rOverlay = document.getElementById('raffleOverlay');
    if (rOverlay) rOverlay.classList.add('active');
    
    setTimeout(() => {
        if (rOverlay) rOverlay.classList.remove('active');
        spinCageAndDraw();
    }, 4000);
}

function spinCageAndDraw() {
    if (isRoundFinished || drawnBalls.length >= 90) return;
    if (bingoCage) bingoCage.classList.add('spinning');
    playMixingSound(2000);
    
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
    
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(ball.toString());
        u.lang = 'es-ES'; u.rate = 0.9;
        window.speechSynthesis.speak(u);
    }

    checkWinners();
    if (!isRoundFinished) setTimeout(spinCageAndDraw, 4000);
}

function checkWinners() {
    if (isPlayerMode) return;
    participants.forEach(p => {
        const hits = p.carton.filter(n => drawnBalls.includes(n)).length;
        if (hits === 5 && !isRoundFinished) {
            isRoundFinished = true;
            winnerInfo = { name: p.name };
            syncGameState();
            showWinnerOverlay(winnerInfo);
        }
    });
}

function showWinnerOverlay(info) {
    isRoundFinished = true;
    const wOverlay = document.getElementById('winnerOverlay');
    const wName = document.getElementById('winnerName');
    if (wName) wName.textContent = info.name;
    if (wOverlay) wOverlay.classList.add('active');
    
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(`¡Bingo! El ganador es ${info.name}`));
    }
}

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = '#' + roundNumber;
    if (drawnBalls.length > 0) {
        currentBallEl.textContent = drawnBalls[drawnBalls.length - 1];
        currentBallEl.style.opacity = 1;
    }
}

function removePlayer(id) { window.db_firebase.collection("jugadores").doc(id).delete(); }
window.removePlayer = removePlayer;

function init() {
    startBtn?.addEventListener('click', () => {
        getAudioCtx(); // Activar audio al primer clic
        startNewRound();
    });
    
    document.getElementById('clearPlayersBtn')?.addEventListener('click', async () => {
        if (!confirm("¿Limpiar todo?")) return;
        const snap = await window.db_firebase.collection("jugadores").get();
        const batch = window.db_firebase.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        window.db_firebase.collection("juego").doc("estado").update({ ganador: null, bolas: [] });
    });

    document.getElementById('addPlayerBtn')?.addEventListener('click', () => {
        getAudioCtx();
        const name = playerNameInput.value.trim();
        if (!name) return;
        localStorage.setItem('bingo_my_name', name);
        window.open("https://checkout.bold.co/payment/LNK_TYRW5PQ2S8", "_blank");
        window.db_firebase.collection("jugadores").add({ name, timestamp: firebase.firestore.FieldValue.serverTimestamp(), status: 'pendiente' });
        playerNameInput.value = '';
    });

    document.getElementById('nextRoundBtn')?.addEventListener('click', () => {
        document.getElementById('winnerOverlay').classList.remove('active');
        isRoundFinished = false;
        if (!isPlayerMode) {
            winnerInfo = null;
            drawnBalls = [];
            syncGameState();
            startBtn.disabled = false;
        }
    });
    
    setupFirebaseSync();
    
    const mb = document.getElementById('masterBoard');
    if (mb) {
        mb.innerHTML = '';
        for(let i=1; i<=90; i++) mb.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`;
    }
}

window.addEventListener('DOMContentLoaded', init);
