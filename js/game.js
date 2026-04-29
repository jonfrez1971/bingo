// DB Simulation Logic
const DB_KEY = 'bingo_db_v1';
const defaultSchema = { usuarios: [], rondas: [], participantes: [], sorteos: [], historialGanadores: [] };

function initDB() {
    if (!localStorage.getItem(DB_KEY)) {
        localStorage.setItem(DB_KEY, JSON.stringify(defaultSchema));
    }
}

function getTable(tableName) {
    const dbData = JSON.parse(localStorage.getItem(DB_KEY));
    return dbData[tableName] || [];
}

function saveTable(tableName, data) {
    const dbData = JSON.parse(localStorage.getItem(DB_KEY));
    dbData[tableName] = data;
    localStorage.setItem(DB_KEY, JSON.stringify(dbData));
}

function generateId(tableName, idField) {
    const table = getTable(tableName);
    if (table.length === 0) return 1;
    return Math.max(...table.map(row => row[idField])) + 1;
}

const db = {
    createUser(nombre, email = '') {
        initDB();
        const table = getTable('usuarios');
        const newUser = { user_id: generateId('usuarios', 'user_id'), nombre, email, fecha_registro: new Date().toISOString() };
        table.push(newUser);
        saveTable('usuarios', table);
        return newUser;
    },
    getAllUsers() { return getTable('usuarios'); },
    createRonda(acumulado) {
        initDB();
        const table = getTable('rondas');
        const newRonda = { ronda_id: generateId('rondas', 'ronda_id'), fecha_inicio: new Date().toISOString(), fecha_fin: null, acumulado: acumulado, ganador_id: null, estado: 'en curso', max_jugadores: 30 };
        table.push(newRonda);
        saveTable('rondas', table);
        return newRonda;
    },
    updateRonda(ronda_id, updates) {
        const table = getTable('rondas');
        const index = table.findIndex(r => r.ronda_id === ronda_id);
        if (index !== -1) {
            table[index] = { ...table[index], ...updates };
            saveTable('rondas', table);
        }
    },
    getLastRonda() {
        const table = getTable('rondas');
        return table[table.length - 1];
    },
    addParticipante(ronda_id, user_id, carton) {
        const table = getTable('participantes');
        const newPart = { participante_id: generateId('participantes', 'participante_id'), ronda_id, user_id, carton };
        table.push(newPart);
        saveTable('participantes', table);
        return newPart;
    },
    getParticipantesByRonda(ronda_id) {
        return getTable('participantes').filter(p => p.ronda_id === ronda_id);
    },
    createSorteo(ronda_id, numero_sorteado, ganador_sorteo) {
        const table = getTable('sorteos');
        const newSorteo = { sorteo_id: generateId('sorteos', 'sorteo_id'), ronda_id, numero_sorteado, ganador_sorteo };
        table.push(newSorteo);
        saveTable('sorteos', table);
        return newSorteo;
    },
    addHistorialGanador(ronda_id, user_id, premio) {
        const table = getTable('historialGanadores');
        const newHist = { historial_id: generateId('historialGanadores', 'historial_id'), ronda_id, user_id, premio, fecha: new Date().toISOString() };
        table.push(newHist);
        saveTable('historialGanadores', table);
        return newHist;
    },
    getHistorialGanadores() { return getTable('historialGanadores'); }
};

initDB();

// DOM ELEMENTS
const startBtn = document.getElementById('startBtn');
const clearPlayersBtn = document.getElementById('clearPlayersBtn');
const raffleOverlay = document.getElementById('raffleOverlay');
const raffleSpinnerText = document.getElementById('raffleSpinnerText');
const jackpotDisplay = document.getElementById('jackpotDisplay');
const roundDisplay = document.getElementById('roundDisplay');
const playersCountTitle = document.getElementById('playersCountTitle');
const currentBallEl = document.getElementById('currentBall');
const raffleNameEl = document.getElementById('raffleName');
const winnersList = document.getElementById('winnersList');
const winnerOverlay = document.getElementById('winnerOverlay');
const winnerMainTitle = document.getElementById('winnerMainTitle');
const winnerSubTitle = document.getElementById('winnerSubTitle');
const winnerNameEl = document.getElementById('winnerName');
const winnerPrizeEl = document.getElementById('winnerPrize');
const nextRoundBtn = document.getElementById('nextRoundBtn');
const introBtn = document.getElementById('introBtn');
const announcerSubtitle = document.getElementById('announcerSubtitle');
const playerNameInput = document.getElementById('playerNameInput');
const addPlayerBtn = document.getElementById('addPlayerBtn');
const playersGrid = document.getElementById('playersGrid');

// GLOBALS
let currentRound = null;
let participants = [];
let drawnBalls = [];
let drawInterval = null;
let jackpot = 10000;
let basePrize = 4000;
let raffleWinnerIds = [];
let isRoundFinished = false;
let players = []; 
let roundNumber = 1;

const urlParams = new URLSearchParams(window.location.search);
const isPlayerMode = urlParams.get('mode') === 'player';

// Firebase Sync
let lastPlayersCount = 0;
function setupFirebaseSync() {
    // Listen for players in real-time
    window.db_firebase.collection("jugadores")
        .onSnapshot((snapshot) => {
            console.log("Cambio detectado en Firebase. Jugadores:", snapshot.size);
            const newPlayers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Ordenar por timestamp localmente para evitar errores de Firebase
            newPlayers.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

            if (newPlayers.length > lastPlayersCount && lastPlayersCount !== 0) {
                playCashSound();
            }
            
            players = newPlayers;
            lastPlayersCount = players.length;
            renderPlayers();
            updateUI();
        }, (error) => {
            console.error("Error en sincronización Firebase:", error);
            alert("Error de conexión con la base de datos. Reintenta.");
        });

    window.db_firebase.collection("juego").doc("estado")
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                drawnBalls = data.bolas || [];
                jackpot = data.jackpot || 10000;
                roundNumber = data.ronda || 1;
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
        ronda: roundNumber,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
}

async function clearAllPlayers() {
    if (!confirm("¿Seguro que quieres borrar a todos los jugadores? Esto reseteará la mesa.")) return;
    if (window.db_firebase) {
        const batch = window.db_firebase.batch();
        const snapshot = await window.db_firebase.collection("jugadores").get();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        alert("Mesa limpia. Todos los jugadores eliminados.");
    }
}

// Audio logic
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
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, startTime);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    noise.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    noise.start(startTime); noise.stop(startTime + duration);
}

function playCashSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1500, now);
    g1.gain.setValueAtTime(0.1, now);
    g1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1.connect(g1); g1.connect(ctx.destination);
    osc1.start(now); osc1.stop(now + 0.3);
}

function renderPlayers() {
    playersGrid.innerHTML = '';
    const myName = localStorage.getItem('bingo_my_name');
    const sorted = [...players].sort((a,b) => (a.name === myName ? -1 : b.name === myName ? 1 : 0));

    sorted.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'player-card' + (p.name === myName ? ' my-card' : '');
        card.id = `player-card-${p.id}`;
        
        const carton = p.carton || [];
        let hits = 0;
        let numbersHtml = carton.length ? carton.map(n => {
            const isMarked = drawnBalls.includes(n);
            if (isMarked) hits++;
            return `<div class="number-capsule ${isMarked ? 'marked' : ''}">${n}</div>`;
        }).join('') : '<div class="number-capsule">-</div>'.repeat(5);

        card.innerHTML = `
            <div class="card-top">
                <span class="player-card-name">${p.name === myName ? '⭐ ' : ''}${p.status==='pendiente_pago' ? '⏳ ' : ''}${p.name}</span>
                ${p.name === myName ? '<span style="font-size:0.5rem; color:#00f0ff;">MI CARTÓN</span>' : ''}
                <button class="delete-btn" onclick="removePlayer('${p.id}')" style="margin-left:auto">🗑️</button>
            </div>
            <div class="card-numbers">${numbersHtml}</div>
            <div class="progress-info"><span>Progreso</span><span>${hits}/5</span></div>
            <div class="progress-container"><div class="progress-bar" style="width:${(hits/5)*100}%"></div></div>
        `;
        playersGrid.appendChild(card);
    });
    if (playersCountTitle) playersCountTitle.textContent = `Jugadores (${players.length})`;
}

function startNewRound() {
    if (players.length === 0) { alert("¡Agrega jugadores!"); return; }
    startBtn.disabled = true;
    document.querySelector('main').classList.add('playing-mode');
    drawnBalls = [];
    isRoundFinished = false;
    currentBallEl.textContent = '--';
    
    for (let i = 1; i <= 90; i++) {
        const mc = document.getElementById(`master-cell-${i}`);
        if(mc) mc.classList.remove('called');
    }

    currentRound = db.createRonda(jackpot);
    roundNumber = currentRound.ronda_id;
    updateUI();
    syncGameState();

    participants = [];
    players.forEach((pObj) => {
        const carton = Array.from({length: 5}, () => Math.floor(Math.random() * 90) + 1).sort((a,b)=>a-b);
        if (window.db_firebase) {
            window.db_firebase.collection("jugadores").doc(pObj.id).update({ carton, status: 'jugando' });
        }
        let user = db.getAllUsers().find(u => u.nombre === pObj.name) || db.createUser(pObj.name);
        const p = db.addParticipante(currentRound.ronda_id, user.user_id, carton);
        participants.push({ ...p, name: user.nombre, cardId: pObj.id, warningsGiven: [] });
    });

    const selected = [...participants].sort(() => 0.5 - Math.random()).slice(0, 2);
    raffleWinnerIds = selected.map(p => p.user_id);
    selected.forEach(p => {
        db.createSorteo(currentRound.ronda_id, p.participante_id, p.user_id);
        const cardEl = document.getElementById(`player-card-${p.cardId}`);
        if (cardEl) cardEl.style.borderColor = "var(--accent)";
    });
    
    raffleNameEl.textContent = selected.map(p => p.name).join(' y ');
    startPreShowRaffle(raffleNameEl.textContent);
}

function startPreShowRaffle(winnerName) {
    raffleOverlay.classList.add('active');
    let ticks = 0;
    const interval = setInterval(() => {
        raffleSpinnerText.textContent = participants[Math.floor(Math.random() * participants.length)].name;
        if (++ticks >= 20) {
            clearInterval(interval);
            raffleSpinnerText.textContent = "¡" + winnerName + "!";
            setTimeout(() => {
                raffleOverlay.classList.remove('active');
                drawInterval = setTimeout(spinCageAndDraw, 2000);
            }, 4000);
        }
    }, 100);
}

function spinCageAndDraw() {
    if (drawnBalls.length >= 90 || isRoundFinished) return;
    const cage = document.getElementById('bingoCage');
    if (cage) cage.classList.add('spinning');
    playMixingSound(2000);
    setTimeout(() => {
        if (cage) cage.classList.remove('spinning');
        drawBall(); 
    }, 2000); 
}

function drawBall() {
    if (drawnBalls.length >= 90 || isRoundFinished) {
        clearTimeout(drawInterval);
        return;
    }
    let ball;
    do { ball = Math.floor(Math.random() * 90) + 1; } while (drawnBalls.includes(ball));
    drawnBalls.push(ball);
    syncGameState();
    currentBallEl.textContent = ball;
    currentBallEl.classList.add('pulse');
    setTimeout(() => currentBallEl.classList.remove('pulse'), 500);
    
    const mc = document.getElementById(`master-cell-${ball}`);
    if (mc) mc.classList.add('called');
    
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(ball.toString());
        u.lang = 'es-ES'; window.speechSynthesis.speak(u);
    }

    checkWinners(ball);
    if (!isRoundFinished) drawInterval = setTimeout(spinCageAndDraw, 4000);
}

function checkWinners(ball) {
    participants.forEach(p => {
        let hits = p.carton.filter(n => drawnBalls.includes(n)).length;
        if (hits === p.carton.length && !isRoundFinished) {
            isRoundFinished = true;
            clearTimeout(drawInterval);
            announceWinner(p);
        }
    });
}

function announceWinner(winner) {
    const wonJackpot = raffleWinnerIds.includes(winner.user_id);
    const prize = wonJackpot ? (4000 * participants.length * 0.7 + jackpot) : (4000 * participants.length * 0.7);
    winnerNameEl.textContent = winner.name;
    winnerPrizeEl.textContent = `Premio: $${prize.toLocaleString()}`;
    winnerOverlay.classList.add('active');
    if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(`¡Bingo! Ganó ${winner.name}`));
}

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = '#' + roundNumber;
}

function removePlayer(id) {
    if (window.db_firebase) window.db_firebase.collection("jugadores").doc(id).delete();
}
window.removePlayer = removePlayer;

function init() {
    startBtn.addEventListener('click', startNewRound);
    clearPlayersBtn.addEventListener('click', clearAllPlayers);
    nextRoundBtn.addEventListener('click', () => {
        winnerOverlay.classList.remove('active');
        document.querySelector('main').classList.remove('playing-mode');
    });
    addPlayerBtn.addEventListener('click', addPlayer);
    setupFirebaseSync();
    
    const mb = document.getElementById('masterBoard');
    if (mb) { mb.innerHTML = ''; for(let i=1; i<=90; i++) mb.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`; }
    
    updateUI();
    renderPlayers();
}

window.addEventListener('DOMContentLoaded', init);
