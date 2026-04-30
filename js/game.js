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
let isRaffleActive = false;

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
        u.lang = 'es-ES'; u.rate = 0.9;
        window.speechSynthesis.speak(u);
    }
}

// Procedural Audio Effects (Luxury Details)
function playPopSound() {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.1);
}

function playCashSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(now + 0.1);
}

// Firebase Sync
function setupFirebaseSync() {
    if (!window.db_firebase) return;

    window.db_firebase.collection("jugadores").onSnapshot((snap) => {
        players = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderPlayers();
    }, err => console.error("Error Firebase:", err));

    window.db_firebase.collection("juego").doc("estado").onSnapshot((doc) => {
        if (doc.exists) {
            const d = doc.data();
            const newBalls = d.bolas || [];
            jackpot = d.jackpot || 10000;
            roundNumber = d.ronda || 1;
            winnerInfo = d.ganador || null;
            raffleWinnerIds = d.raffleWinnerIds || [];
            const raffleActive = d.raffleActive || false;
            const isSpinning = d.isSpinning || false;

            const rOverlay = document.getElementById('raffleOverlay');
            const rName = document.getElementById('raffleName');
            const sRName = document.getElementById('sidebarRaffleName');
            
            if (raffleActive && !isRaffleActive) {
                const names = raffleWinnerIds.join(' y ');
                if (rName) rName.textContent = names;
                if (sRName) sRName.textContent = names;
                if (rOverlay) rOverlay.classList.add('active');
                speakText("Sorteando acumulado. Atentos: " + names);
            } else if (!raffleActive && isRaffleActive) {
                if (rOverlay) rOverlay.classList.remove('active');
                // Keep the names in the sidebar so people know who won the raffle
            }
            isRaffleActive = raffleActive;

            if (bingoCage) {
                if (isSpinning) {
                    bingoCage.classList.add('spinning');
                    playCageSound();
                } else {
                    bingoCage.classList.remove('spinning');
                }
            }

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
        raffleActive: isRaffleActive,
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

    // Pin my card to the top
    const sorted = [...players].sort((a,b) => {
        if (a.name === myName) return -1;
        if (b.name === myName) return 1;
        return 0;
    });

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
                <span class="player-card-name" style="font-size:0.85rem; font-weight:900;">
                    ${isWinnerInRaffle ? '🏆 ' : ''}${p.name === myName ? '⭐ ' : ''}${isPending ? '<span style="color:var(--accent); animation:pulse 1s infinite;">⏳ </span>' : ''}${p.name}
                </span>
                ${p.name === myName ? '<span style="font-size:0.6rem; color:var(--secondary); font-weight:bold;">MI CARTÓN</span>' : ''}
                ${!isPlayerMode ? `<button onclick="removePlayer('${p.id}')" style="margin-left:auto; background:none; border:none; color:rgba(255,255,255,0.3); cursor:pointer; font-size:0.8rem;">🗑️</button>` : ''}
            </div>
            ${isPending ? '<div style="font-size:0.6rem; color:var(--accent); text-align:center; font-weight:bold; margin-bottom:5px;">PAGO PENDIENTE</div>' : ''}
            <div class="card-numbers">${nums}</div>
            <div class="progress-info" style="margin-top:5px;"><span>Progreso</span><span>${hits}/5</span></div>
            <div class="progress-container"><div class="progress-bar" style="width:${(hits/5)*100}%"></div></div>
        `;
        playersGrid.appendChild(card);
    });
}

async function addPlayer() {
    getAudioCtx();
    const name = playerNameInput.value.trim();
    if (!name) return alert("Por favor, escribe tu nombre.");
    
    // Check duplicates
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return alert("Este nombre ya está en juego. Por favor usa un apellido o número.");
    }
    
    if (players.length >= 30) return alert("Lo sentimos, la mesa está llena (Máximo 30 jugadores).");

    try {
        // 1. REGISTRAR PRIMERO (CON AWAIT PARA ASEGURAR QUE SE GUARDE)
        await window.db_firebase.collection("jugadores").add({
            name: name,
            time: Date.now(),
            status: 'pendiente',
            carton: []
        });

        // 2. HABLAR BIENVENIDA Y SONIDO
        playCashSound();
        speakText(`Bienvenido ${name}. Por favor completa tu pago en la nueva pestaña para entrar al sorteo.`);
        
        // 3. ABRIR PAGO
        window.open("https://checkout.bold.co/payment/LNK_TYRW5PQ2S8", "_blank");

        // 4. PERSISTENCIA LOCAL
        localStorage.setItem('bingo_my_name', name);
        playerNameInput.value = '';
        
    } catch (err) {
        console.error("Error al registrar:", err);
        alert("Hubo un error al registrarte. Revisa tu conexión.");
    }
}

function startNewRound() {
    if (isPlayerMode) return;
    if (players.length === 0) return alert("¡Agrega al menos un jugador para empezar!");
    
    startBtn.disabled = true;
    drawnBalls = [];
    isRoundFinished = false;
    winnerInfo = null;

    // Acumulado Logic: Incrementar por jugador
    const increment = players.length * 1000;
    jackpot += increment;
    
    // Create internal DB record
    const currentRound = db.createRonda(jackpot);
    roundNumber = currentRound.ronda_id;

    // Reset players in Firebase and assign random cards
    participants = [];
    
    // Use a small delay for each player to avoid UI freeze
    players.forEach((pObj, index) => {
        const carton = [];
        while(carton.length < 5) {
            const n = Math.floor(Math.random() * 90) + 1;
            if(!carton.includes(n)) carton.push(n);
        }
        carton.sort((a,b) => a - b);
        
        window.db_firebase.collection("jugadores").doc(pObj.id).update({ 
            carton: carton, 
            status: 'jugando' 
        });

        const user = db.createUser(pObj.name);
        const p = db.addParticipante(roundNumber, user.user_id, carton);
        participants.push({...p, name: pObj.name, cardId: pObj.id});
    });

    // Raffle for the Jackpot
    const eligible = [...participants];
    const selected = [];
    while(selected.length < 2 && eligible.length > 0) {
        const idx = Math.floor(Math.random() * eligible.length);
        selected.push(eligible.splice(idx, 1)[0]);
    }
    
    raffleWinnerIds = selected.map(p => p.name);
    isRaffleActive = true;
    syncGameState();

    setTimeout(() => {
        isRaffleActive = false;
        syncGameState();
        spinCageAndDraw();
    }, 6000);
}

// Procedural Cage Effect
function createCageBalls() {
    if (!bingoCage) return;
    bingoCage.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const ball = document.createElement('div');
        ball.className = 'cage-ball';
        ball.style.left = Math.random() * 80 + 10 + '%';
        ball.style.top = Math.random() * 80 + 10 + '%';
        ball.style.animationDelay = Math.random() * 0.5 + 's';
        bingoCage.appendChild(ball);
    }
}

function playCageSound() {
    const ctx = getAudioCtx();
    const duration = 2.0;
    const startTime = ctx.currentTime;
    
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, startTime);
    filter.frequency.exponentialRampToValueAtTime(100, startTime + duration);
    
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    noise.start(startTime);
    noise.stop(startTime + duration);
}

function spinCageAndDraw() {
    if (isRoundFinished || drawnBalls.length >= 90) return;
    syncGameState({ isSpinning: true });
    setTimeout(() => {
        syncGameState({ isSpinning: false });
        drawBall();
    }, 2000);
}

function drawBall() {
    if (isRoundFinished || isPlayerMode) return;
    let ball;
    do { ball = Math.floor(Math.random()*90)+1; } while (drawnBalls.includes(ball));
    drawnBalls.push(ball);
    playPopSound();
    syncGameState();
    checkWinners();
    if (!isRoundFinished) setTimeout(spinCageAndDraw, 4500);
}

function checkWinners() {
    if (isPlayerMode) return;
    const base = (players.length * 4000) * 0.7;
    participants.forEach(p => {
        const hits = (p.carton || []).filter(n => drawnBalls.includes(n)).length;
        if (hits === 5 && !isRoundFinished) {
            isRoundFinished = true;
            const wonJackpot = raffleWinnerIds.includes(p.name);
            const totalPrize = wonJackpot ? (base + jackpot) : base;
            winnerInfo = { name: p.name, prize: totalPrize, isJackpot: wonJackpot };
            
            // If jackpot won, reset it for the next round
            if (wonJackpot) {
                jackpot = 10000; // Reset to base value
            }
            
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
    
    if (wOverlay) {
        wOverlay.classList.add('active');
        if (info.isJackpot) {
            wOverlay.classList.add('jackpot-win');
            speakText(`¡ATENCIÓN! Bingo y ganador del acumulado: ${info.name}. Premio total: ${info.prize} pesos.`);
        } else {
            wOverlay.classList.remove('jackpot-win');
            speakText(`¡Bingo! Ganador: ${info.name}.`);
        }
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

function removePlayer(id) {
    if (isPlayerMode) return;
    if (confirm("¿Eliminar?")) window.db_firebase.collection("jugadores").doc(id).delete();
}
window.removePlayer = removePlayer;

function clearAllPlayers() {
    if (isPlayerMode) return;
    if (confirm("¿ESTÁS SEGURO? Esto borrará a TODOS los jugadores de la mesa.")) {
        players.forEach(p => {
            window.db_firebase.collection("jugadores").doc(p.id).delete();
        });
        alert("Mesa limpia.");
    }
}
window.clearAllPlayers = clearAllPlayers;

function init() {
    if (isPlayerMode) {
        const sBtn = document.getElementById('startBtn');
        const cBtn = document.getElementById('clearPlayersBtn');
        if (sBtn) sBtn.style.display = 'none';
        if (cBtn) cBtn.style.display = 'none';
    }

    startBtn?.addEventListener('click', () => { getAudioCtx(); startNewRound(); });
    document.getElementById('addPlayerBtn')?.addEventListener('click', addPlayer);
    document.getElementById('clearPlayersBtn')?.addEventListener('click', clearAllPlayers);
    
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
    createCageBalls();
    const mb = document.getElementById('masterBoard');
    if (mb) { mb.innerHTML = ''; for(let i=1; i<=90; i++) mb.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`; }
}

window.addEventListener('DOMContentLoaded', init);
