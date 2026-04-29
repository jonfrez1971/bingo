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
    createSorteo(r, p, u) { const table = getTable('sorteos'); const n = { sorteo_id: generateId('sorteos', 'sorteo_id'), ronda_id: r, participante_id: p, user_id: u }; table.push(n); saveTable('sorteos', table); return n; },
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

// Global State
let players = [];
let drawnBalls = [];
let roundNumber = 1;
let jackpot = 10000;
let isRoundFinished = false;
let participants = [];
let raffleWinnerIds = [];

const isPlayerMode = new URLSearchParams(window.location.search).get('mode') === 'player';

// Firebase Sync
function setupFirebaseSync() {
    if (!window.db_firebase) return;

    // Escuchar jugadores con persistencia forzada
    window.db_firebase.collection("jugadores").onSnapshot((snap) => {
        players = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPlayers();
    }, err => {
        console.error("Error Firebase:", err);
    });

    // Escuchar estado del juego y forzar UI
    window.db_firebase.collection("juego").doc("estado").onSnapshot((doc) => {
        if (doc.exists) {
            const d = doc.data();
            drawnBalls = d.bolas || [];
            jackpot = d.jackpot || 10000;
            roundNumber = d.ronda || 1;
            updateUI();
            renderPlayers();
        }
    });
}

function syncGameState() {
    if (!window.db_firebase || isPlayerMode) return;
    window.db_firebase.collection("juego").doc("estado").set({
        bolas: drawnBalls,
        jackpot: jackpot,
        ronda: roundNumber
    });
}

async function clearAllPlayers() {
    if (!confirm("¿Borrar todos los jugadores?")) return;
    const snap = await window.db_firebase.collection("jugadores").get();
    const batch = window.db_firebase.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
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
    const title = document.getElementById('playersCountTitle');
    if (title) title.textContent = `Jugadores (${players.length})`;
}

function addPlayer() {
    const name = playerNameInput.value.trim();
    if (!name) return alert("Escribe tu nombre");
    localStorage.setItem('bingo_my_name', name);
    if (confirm(`¿Inscribir a ${name} y pagar?`)) {
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
    if (players.length === 0) return alert("No hay jugadores");
    startBtn.disabled = true;
    drawnBalls = [];
    isRoundFinished = false;
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

    const selected = [...participants].sort(()=>0.5-Math.random()).slice(0,2);
    raffleWinnerIds = selected.map(p => p.user_id);
    const raffleEl = document.getElementById('raffleName');
    if (raffleEl) raffleEl.textContent = selected.map(p=>p.name).join(' y ');
    
    // Iniciar dibujo
    setTimeout(drawBall, 3000);
}

function drawBall() {
    if (isRoundFinished || drawnBalls.length >= 90) return;
    let ball;
    do { ball = Math.floor(Math.random()*90)+1; } while (drawnBalls.includes(ball));
    drawnBalls.push(ball);
    syncGameState();
    currentBallEl.textContent = ball;
    
    // Hablar
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(ball.toString()));

    // Marcar en tablero
    const mc = document.getElementById(`master-cell-${ball}`);
    if (mc) mc.classList.add('called');

    checkWinners();
    if (!isRoundFinished) setTimeout(drawBall, 4000);
}

function checkWinners() {
    participants.forEach(p => {
        const hits = p.carton.filter(n => drawnBalls.includes(n)).length;
        if (hits === 5 && !isRoundFinished) {
            isRoundFinished = true;
            alert("¡BINGO! Ganó " + p.name);
            const wName = document.getElementById('winnerName');
            const wOverlay = document.getElementById('winnerOverlay');
            if (wName) wName.textContent = p.name;
            if (wOverlay) wOverlay.classList.add('active');
        }
    });
}

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = '#' + roundNumber;
}

function removePlayer(id) { window.db_firebase.collection("jugadores").doc(id).delete(); }
window.removePlayer = removePlayer;

function init() {
    startBtn?.addEventListener('click', startNewRound);
    clearPlayersBtn?.addEventListener('click', clearAllPlayers);
    document.getElementById('addPlayerBtn')?.addEventListener('click', addPlayer);
    document.getElementById('nextRoundBtn')?.addEventListener('click', () => {
        document.getElementById('winnerOverlay').classList.remove('active');
        startBtn.disabled = false;
    });
    
    setupFirebaseSync();
    
    const mb = document.getElementById('masterBoard');
    if (mb) { mb.innerHTML = ''; for(let i=1; i<=90; i++) mb.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`; }
}

window.addEventListener('DOMContentLoaded', init);
