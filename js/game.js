// DB Simulation Logic
const DB_KEY = 'bingo_db_v1';
const defaultSchema = { usuarios: [], rondas: [], participantes: [], sorteos: [], historialGanadores: [] };

function initDB() {
    if (!localStorage.getItem(DB_KEY)) {
        localStorage.setItem(DB_KEY, JSON.stringify(defaultSchema));
    }
}

function getTable(tableName) {
    const db = JSON.parse(localStorage.getItem(DB_KEY));
    return db[tableName] || [];
}

function saveTable(tableName, data) {
    const db = JSON.parse(localStorage.getItem(DB_KEY));
    db[tableName] = data;
    localStorage.setItem(DB_KEY, JSON.stringify(db));
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
        if (table.filter(p => p.ronda_id === ronda_id).length >= 30) throw new Error('Límite de 30 jugadores alcanzado.');
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

// GAME LOGIC
const startBtn = document.getElementById('startBtn');
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

let currentRound = null;
let participants = [];
let drawnBalls = [];
let drawInterval = null;
let jackpot = 10000;
let basePrize = 500;
let raffleWinnerIds = [];
let isRoundFinished = false;
let players = []; // Now synced with Firebase
const urlParams = new URLSearchParams(window.location.search);
const isPlayerMode = urlParams.get('mode') === 'player';

// Firebase Sync Logic
let lastPlayersCount = 0;
function setupFirebaseSync() {
    if (!window.db_firebase) {
        console.warn("Firebase no detectado. Modo local activado.");
        return;
    }

    // Listen for players in real-time
    window.db_firebase.collection("jugadores").orderBy("timestamp", "asc")
        .onSnapshot((snapshot) => {
            const newPlayers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            if (newPlayers.length > lastPlayersCount && lastPlayersCount !== 0) {
                playCashSound();
            }
            
            players = newPlayers;
            lastPlayersCount = players.length;
            renderPlayers();
            updateUI();
        }, (error) => {
            console.error("Error en sincronización Firebase:", error);
        });

    // Listen for the game state (drawn balls)
    window.db_firebase.collection("juego").doc("estado")
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                calledNumbers = data.bolas || [];
                jackpot = data.jackpot || 10000;
                roundNumber = data.ronda || 1;
                
                updateUI();
                renderPlayers(); // This will mark the numbers in real-time
            }
        });
}

function syncGameState() {
    if (!window.db_firebase || isPlayerMode) return;
    
    window.db_firebase.collection("juego").doc("estado").set({
        bolas: calledNumbers,
        jackpot: jackpot,
        ronda: roundNumber,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error("Error sync bolas:", err));
}

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

    // Simulate ball mixing with filtered noise and short pulses
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, startTime);
    filter.frequency.exponentialRampToValueAtTime(800, startTime + duration);
    filter.Q.value = 5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(startTime);
    noise.stop(startTime + duration);

    // Add some random "clacks"
    for (let t = 0; t < duration; t += 0.1 + Math.random() * 0.2) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(200 + Math.random() * 800, startTime + t);
        g.gain.setValueAtTime(0.05, startTime + t);
        g.gain.exponentialRampToValueAtTime(0.01, startTime + t + 0.03);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(startTime + t);
        osc.stop(startTime + t + 0.03);
    }
}

function playCashSound() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    
    // Bell "Ding"
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(1500, now);
    osc1.frequency.exponentialRampToValueAtTime(1000, now + 0.3);
    g1.gain.setValueAtTime(0.1, now);
    g1.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc1.connect(g1);
    g1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Secondary ring
    setTimeout(() => {
        const osc2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(2000, ctx.currentTime);
        g2.gain.setValueAtTime(0.05, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc2.connect(g2);
        g2.connect(ctx.destination);
        osc2.start(ctx.currentTime);
        osc2.stop(ctx.currentTime + 0.1);
    }, 100);
}

function playIntroSequence() {
    if (introBtn) introBtn.disabled = true;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (announcerSubtitle) announcerSubtitle.textContent = `"¡Bienvenidos a Bingo Spress Líneas! Inscribe a los jugadores y prepárate para ganar."`;
    if ('speechSynthesis' in window) {
        let u = new SpeechSynthesisUtterance("¡Hola! Atentos todos. Inscribe a los jugadores, elige el modo y dale a Iniciar Ronda.");
        u.lang = 'es-ES';
        window.speechSynthesis.speak(u);
    }
    setTimeout(() => { if (introBtn) introBtn.disabled = false; }, 4000);
}

function init() {
    startBtn.addEventListener('click', startNewRound);
    
    // Hide Admin buttons if in Player Mode
    if (isPlayerMode) {
        startBtn.style.display = 'none';
        document.querySelector('.caller-section').style.display = 'none';
        document.querySelector('main').style.gridTemplateColumns = '1fr';
        document.querySelector('.logo h1').textContent = "Inscripción Bingo Spress";
    }

    if (introBtn) introBtn.addEventListener('click', playIntroSequence);
    
    setupFirebaseSync();
    nextRoundBtn.addEventListener('click', () => {
        winnerOverlay.classList.remove('active');
        document.querySelector('main').classList.remove('playing-mode');
        // Reset progress on all cards
        renderPlayers();
    });

    addPlayerBtn.addEventListener('click', addPlayer);
    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addPlayer();
    });

    updateWinnersHistory();
    // Default jackpot handling...
    updateUI();

    renderPlayers();

    const masterBoardEl = document.getElementById('masterBoard');
    if (masterBoardEl) {
        masterBoardEl.innerHTML = '';
        for (let i = 1; i <= 90; i++) {
            masterBoardEl.innerHTML += `<div class="master-cell" id="master-cell-${i}">${i}</div>`;
        }
    }

    const bingoCage = document.getElementById('bingoCage');
    if (bingoCage) {
        bingoCage.innerHTML = '';
        for (let i = 0; i < 40; i++) {
            const b = document.createElement('div');
            b.className = 'cage-ball';
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 65; 
            b.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
            b.style.top = `calc(50% + ${Math.sin(angle) * radius}px)`;
            if (Math.random() > 0.5) b.style.background = 'var(--accent)';
            if (Math.random() > 0.8) b.style.background = '#fff';
            bingoCage.appendChild(b);
        }
    }
}

function addPlayer() {
    const name = playerNameInput.value.trim();
    if (!name) {
        alert("Por favor, ingresa tu nombre.");
        return;
    }

    // Recordar nombre en este dispositivo
    localStorage.setItem('bingo_my_name', name);
    
    // Verificar si el nombre ya existe
    const exists = players.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists) {
        alert(`Ya hay un jugador llamado "${name}". Por favor agrega un apellido o número (ej: ${name} Pérez o ${name} 2) para poder identificarte.`);
        return;
    }
    
    const BOLD_LINK = "https://checkout.bold.co/payment/LNK_TYRW5PQ2S8";
    
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(`Bienvenido, ${name}. Completa tu pago para entrar al sorteo.`);
        msg.lang = 'es-ES';
        window.speechSynthesis.speak(msg);
    }

    const confirmPayment = confirm(`¿Inscribir a ${name} y abrir pasarela de pago?`);
    
    if (confirmPayment) {
        window.open(BOLD_LINK, '_blank');

        if (window.db_firebase) {
            window.db_firebase.collection("jugadores").add({
                name: name,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                status: 'pendiente_pago'
            });
            playerNameInput.value = '';
        } else {
            const id = Date.now();
            players.push({ id, name, status: 'pendiente_pago' });
            localStorage.setItem('bingo_players_list', JSON.stringify(players));
            playerNameInput.value = '';
            renderPlayers();
        }
    }
}

function openBoldCheckout() {
    const BOLD_LINK = "https://checkout.bold.co/payment/LNK_TYRW5PQ2S8"; 
    alert("Redirigiendo a tu pasarela segura de Bold...");
    window.open(BOLD_LINK, '_blank');
}
window.openBoldCheckout = openBoldCheckout;

function removePlayer(id) {
    players = players.filter(p => p.id !== id);
    localStorage.setItem('bingo_players_list', JSON.stringify(players));
    renderPlayers();
}

function renderPlayers() {
    playersGrid.innerHTML = '';
    const myName = localStorage.getItem('bingo_my_name');
    
    const sortedPlayers = [...players].sort((a, b) => {
        if (a.name === myName) return -1;
        if (b.name === myName) return 1;
        return 0;
    });

    sortedPlayers.forEach((p) => {
        const card = document.createElement('div');
        card.className = 'player-card';
        if (p.name === myName) card.classList.add('my-card');
        card.id = `player-card-${p.id}`;
        
        const isPending = p.status === 'pendiente_pago';
        const carton = p.carton || []; // Obtener cartón de Firebase
        
        // Calcular aciertos basados en las bolas cantadas (llamadas desde Firebase)
        let hits = 0;
        let numbersHtml = '';
        
        if (carton.length > 0) {
            numbersHtml = carton.map((n) => {
                const isMarked = calledNumbers.includes(n);
                if (isMarked) hits++;
                return `<div class="number-capsule ${isMarked ? 'marked' : ''}">${n}</div>`;
            }).join('');
        } else {
            numbersHtml = '<div class="number-capsule">-</div>'.repeat(5);
        }

        const progressPercent = (hits / 5) * 100;

        card.innerHTML = `
            <div class="card-top">
                <span class="player-card-name" style="white-space: normal; overflow: visible;">
                    ${p.name === myName ? '⭐ ' : ''}${isPending ? '⏳ ' : ''}${p.name}
                </span>
                ${p.name === myName ? '<span style="font-size:0.5rem; color:#00f0ff; font-weight:bold;">MI CARTÓN</span>' : ''}
                ${isPending ? '<span style="font-size:0.5rem; color:var(--accent); font-weight:bold; display:block;">PAGO PENDIENTE</span>' : ''}
                <button class="delete-btn" onclick="removePlayer('${p.id}')" style="margin-left: auto;">🗑️</button>
            </div>
            <div class="card-numbers">
                ${numbersHtml}
            </div>
            <div class="progress-info">
                <span>Progreso</span>
                <span>${hits}/5</span>
            </div>
            <div class="progress-container">
                <div class="progress-bar" style="width: ${progressPercent}%"></div>
            </div>
        `;
        playersGrid.appendChild(card);
    });
}
window.removePlayer = removePlayer; // Make it global for onclick

function updateUI() {
    jackpotDisplay.textContent = '$' + jackpot.toLocaleString();
    roundDisplay.textContent = currentRound ? '#' + currentRound.ronda_id : '#--';
}

function speakNumber(num) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(num.toString());
        utterance.lang = 'es-ES';
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

function getRandomSubset(min, max, count) {
    let arr = [];
    while(arr.length < count) {
        let r = Math.floor(Math.random() * (max - min + 1)) + min;
        if(arr.indexOf(r) === -1) arr.push(r);
    }
    return arr.sort((a,b)=>a-b);
}

function generateRandomCard(count) {
    return getRandomSubset(1, 90, count);
}

function startNewRound() {
    const numPerCard = 5;
    
    startBtn.disabled = true;
    document.querySelector('main').classList.add('playing-mode');
    
    drawnBalls = [];
    isRoundFinished = false;
    syncGameState(); // Limpiar bolas en Firebase para la nueva ronda
    currentBallEl.textContent = '--';
    currentBallEl.classList.remove('pulse');
    
    for (let i = 1; i <= 90; i++) {
        const mc = document.getElementById(`master-cell-${i}`);
        if(mc) mc.classList.remove('called');
    }
    
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    
    // Lógica de Acumulado: Buscar la última ronda para ver si se ganó el premio mayor
    const lastRound = db.getLastRonda();
    if (lastRound) {
        const history = db.getHistorialGanadores();
        const lastWinnerEntry = history.find(h => h.ronda_id === lastRound.ronda_id);
        
        // Verificamos si el ganador de la ronda anterior estaba en el sorteo (raffleWinnerIds de esa ronda)
        // En nuestro sistema simplificado, si el premio registrado fue mayor al basePrize, es que ganó el acumulado.
        const basePrizeLast = (db.getParticipantesByRonda(lastRound.ronda_id).length * 4000) * 0.7;
        const wasJackpotWon = lastWinnerEntry && lastWinnerEntry.premio > (basePrizeLast + 100);

        if (wasJackpotWon || lastRound.estado === 'nuevo') {
            jackpot = 10000;
        } else {
            jackpot = (lastRound.acumulado || 10000) + 5000;
        }
    } else {
        jackpot = 10000;
    }

    currentRound = db.createRonda(jackpot);
    updateUI();

    participants = [];
    if (players.length === 0) {
        alert("¡Agrega al menos 1 jugador!");
        document.querySelector('main').classList.remove('playing-mode');
        return;
    }

    players.forEach((playerObj) => {
        const carton = generateRandomCard(numPerCard);
        
        // Actualizar en Firebase para que el jugador vea su cartón
        if (window.db_firebase) {
            window.db_firebase.collection("jugadores").doc(playerObj.id).update({
                carton: carton,
                status: 'jugando'
            });
        }

        let user = db.getAllUsers().find(u => u.nombre === playerObj.name);
        if (!user) user = db.createUser(playerObj.name);
        
        try {
            const p = db.addParticipante(currentRound.ronda_id, user.user_id, carton);
            participants.push({ ...p, name: user.nombre, cardId: playerObj.id, warningsGiven: [] });
        } catch(e) { console.error(e); }
    });

    const validSlots = participants.length;

    basePrize = (validSlots * 4000) * 0.7;

    // Seleccionamos 2 jugadores para el acumulado (según solicitud)
    const shuffled = [...participants].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(participants.length, 2));
    raffleWinnerIds = selected.map(p => p.user_id);
    
    selected.forEach(p => {
        db.createSorteo(currentRound.ronda_id, p.participante_id, p.user_id);
        const cardEl = document.getElementById(`player-card-${p.cardId}`);
        if (cardEl) {
            const nameEl = cardEl.querySelector('.player-card-name');
            if (nameEl) nameEl.innerHTML = `🏆 ${p.name}`;
            cardEl.style.borderColor = "var(--accent)";
        }
    });
    
    const winnerNames = selected.map(p => p.name).join(' y ');
    raffleNameEl.textContent = winnerNames;
    startPreShowRaffle(winnerNames);
}

function startPreShowRaffle(winnerName) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("Sorteando el premio acumulado..."));
    }
    raffleOverlay.classList.add('active');
    
    let ticks = 0;
    const maxTicks = 20;
    const spinInterval = setInterval(() => {
        const randomTempName = participants[Math.floor(Math.random() * participants.length)].name;
        raffleSpinnerText.textContent = randomTempName;
        ticks++;
        if (ticks >= maxTicks) {
            clearInterval(spinInterval);
            raffleSpinnerText.textContent = "¡" + winnerName + "!";
            raffleSpinnerText.style.color = "var(--secondary)";
            
            // Announce names and jackpot
            if ('speechSynthesis' in window) {
                const jackpotText = jackpot.toLocaleString();
                const speech = new SpeechSynthesisUtterance(`${winnerName} van por el acumulado. El acumulado en juego es de ${jackpotText} pesos.`);
                speech.lang = 'es-ES';
                window.speechSynthesis.speak(speech);
            }

            setTimeout(() => {
                raffleOverlay.classList.remove('active');
                raffleSpinnerText.style.color = "white"; 
                if (announcerSubtitle) announcerSubtitle.textContent = `"¡Comienza la partida! Mucha suerte a todos."`;
                drawInterval = setTimeout(spinCageAndDraw, 2000);
            }, 5000); // Increased timeout to let the locutor finish speaking
        }
    }, 100);
}

function spinCageAndDraw() {
    if (drawnBalls.length >= 90 || isRoundFinished) return;
    
    currentBallEl.classList.remove('pulse');
    currentBallEl.style.opacity = '0';

    const cage = document.getElementById('bingoCage');
    if (cage) {
        cage.classList.add('spinning');
        playMixingSound(2000); // Trigger the mixing sound
    }
    
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

    let nextBall;
    do { nextBall = Math.floor(Math.random() * 90) + 1; } while (drawnBalls.includes(nextBall));

    drawnBalls.push(nextBall);
    syncGameState(); // Enviar a Firebase para que los jugadores lo vean en vivo
    
    void currentBallEl.offsetWidth; 
    currentBallEl.textContent = nextBall;
    currentBallEl.classList.add('pulse');
    
    speakNumber(nextBall);
    
    const masterCell = document.getElementById(`master-cell-${nextBall}`);
    if (masterCell) masterCell.classList.add('called');

    checkWinners(nextBall);
    
    if (!isRoundFinished) {
        drawInterval = setTimeout(spinCageAndDraw, 4000);
    }
}

function checkWinners(ball) {
    participants.forEach(p => {
        let idxOnCard = p.carton.indexOf(ball);
        if (idxOnCard !== -1) {
            const cell = document.getElementById(`cell-${p.participante_id}-${idxOnCard}`);
            if (cell) cell.classList.add('marked');
        }
        
        let hits = p.carton.filter(n => drawnBalls.includes(n)).length;
        
        // Update Progress UI
        const progressText = document.getElementById(`progress-text-${p.cardId}`);
        const progressBar = document.getElementById(`progress-bar-${p.cardId}`);
        if (progressText) progressText.textContent = `${hits}/5`;
        if (progressBar) progressBar.style.width = `${(hits / 5) * 100}%`;

        // Emotion Logic (Announce almost-winner)
        if (hits === p.carton.length - 1 && !p.warningsGiven.includes('almost')) {
            p.warningsGiven.push('almost');
            const cardEl = document.getElementById(`player-card-${p.cardId}`);
            if (cardEl) cardEl.classList.add('almost-winner');
            
            if ('speechSynthesis' in window) {
                window.speechSynthesis.speak(new SpeechSynthesisUtterance(`¡Atención! A ${p.name} le falta solo un número.`));
            }
            if (announcerSubtitle) announcerSubtitle.textContent = `"¡Cuidado! ${p.name} está a punto de ganar."`;
        }

        if (hits === p.carton.length && !isRoundFinished) {
            isRoundFinished = true;
            clearTimeout(drawInterval);
            announceWinner(p);
        }
    });
}

function announceWinner(winner) {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    
    const cardEl = document.getElementById(`player-card-${winner.cardId}`);
    if (cardEl) {
        cardEl.classList.add('winner');
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    let wonJackpot = raffleWinnerIds.includes(winner.user_id);
    let prize = wonJackpot ? (basePrize + currentRound.acumulado) : basePrize;
    
    db.addHistorialGanador(currentRound.ronda_id, winner.user_id, prize);
    db.updateRonda(currentRound.ronda_id, { estado: 'finalizada', fecha_fin: new Date().toISOString(), ganador_id: winner.user_id });

    winnerNameEl.textContent = winner.name;
    winnerPrizeEl.textContent = `Premio: $${prize.toLocaleString()} ${wonJackpot ? '(¡Incluye Acumulado!)' : ''}`;
    
    if (wonJackpot) {
        winnerOverlay.classList.add('jackpot-win');
        winnerMainTitle.textContent = "¡GANÓ EL ACUMULADO!";
    } else {
        winnerOverlay.classList.remove('jackpot-win');
        winnerMainTitle.textContent = "¡BINGO!";
    }

    winnerOverlay.classList.add('active');
    
    if ('speechSynthesis' in window) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(`¡Felicidades! ${winner.name} ha ganado la ronda.`));
    }
    
    updateWinnersHistory();
}

function updateWinnersHistory() {
    const history = db.getHistorialGanadores().reverse().slice(0, 8);
    winnersList.innerHTML = '';
    history.forEach(h => {
        const u = db.getAllUsers().find(user => user.user_id === h.user_id);
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.padding = '8px';
        div.style.fontSize = '0.9rem';
        div.innerHTML = `<strong>Ronda #${h.ronda_id}</strong><br><span style="color:var(--secondary)">${u ? u.nombre : 'Desconocido'}</span> - <span style="color:var(--accent)">$${h.premio.toLocaleString()}</span>`;
        winnersList.appendChild(div);
    });
}

window.addEventListener('DOMContentLoaded', init);
