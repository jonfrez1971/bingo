// Dinamicas J - Logic
const rifaGrid = document.getElementById('rifaGrid');
const selectionBar = document.getElementById('selectionBar');
const selectedNumText = document.getElementById('selectedNumText');
const activeLotteryEl = document.getElementById('activeLottery');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');

let selectedNumber = null;
let takenNumbers = {}; // { "05": { name: "Juan", status: "pagado" } }

const lotteries = [
    "Dorado Noche",     // 0: Domingo
    "L. Cundinamarca",  // 1: Lunes
    "L. Cruz Roja",     // 2: Martes
    "L. del Valle",     // 3: Miércoles
    "L. de Bogotá",     // 4: Jueves
    "L. de Medellín",   // 5: Viernes
    "L. de Boyacá"      // 6: Sábado
];

function updateLotteryInfo() {
    const day = new Date().getDay();
    activeLotteryEl.textContent = "Hoy: " + lotteries[day];
}

function initGrid() {
    rifaGrid.innerHTML = '';
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        const box = document.createElement('div');
        box.className = 'number-box';
        box.textContent = num;
        box.id = `num-${num}`;
        
        box.onclick = () => selectNumber(num);
        rifaGrid.appendChild(box);
    }
}

function selectNumber(num) {
    if (takenNumbers[num]) return; // Already sold

    // Deselect previous
    const prev = document.querySelector('.number-box.selected');
    if (prev) prev.classList.remove('selected');

    if (selectedNumber === num) {
        selectedNumber = null;
        selectionBar.classList.remove('active');
    } else {
        selectedNumber = num;
        document.getElementById(`num-${num}`).classList.add('selected');
        selectedNumText.textContent = num;
        selectionBar.classList.add('active');
    }
}

// Firebase Sync
function syncRifa() {
    db.collection("rifas_activas").doc("sorteo_actual").onSnapshot((doc) => {
        if (doc.exists) {
            takenNumbers = doc.data().puestos || {};
            updateGridStatus();
        } else {
            // Initialize if first time
            db.collection("rifas_activas").doc("sorteo_actual").set({ puestos: {} });
        }
    });
}

function updateGridStatus() {
    let count = 0;
    for (let i = 0; i < 100; i++) {
        const num = i.toString().padStart(2, '0');
        const box = document.getElementById(`num-${num}`);
        if (takenNumbers[num]) {
            box.classList.add('taken');
            box.classList.remove('selected');
            count++;
        } else {
            box.classList.remove('taken');
        }
    }
    
    // Update progress bar
    const percent = (count / 80) * 100; // 80 is the goal
    const realPercent = (count / 100) * 100;
    progressBar.style.width = Math.min(realPercent, 100) + '%';
    progressPercent.textContent = Math.floor(realPercent) + '%';
    
    if (realPercent >= 80) {
        progressBar.style.background = 'linear-gradient(to right, #00ff88, #fff)';
    }
}

document.getElementById('buyBtn').onclick = () => {
    if (!selectedNumber) return;
    
    const name = prompt("Escribe tu nombre para apartar el " + selectedNumber + ":");
    if (!name) return;

    // Direct WhatsApp link for payment
    const msg = encodeURIComponent(`Hola, quiero apartar el número ${selectedNumber} para la rifa Dinamicas J de hoy.`);
    window.open(`https://wa.me/3151346112?text=${msg}`, '_blank');
    
    // Optimistic UI or wait for admin to add it?
    // In this raffle, usually the admin adds it after verification.
    // But we can add it as "pending"
    db.collection("rifas_activas").doc("sorteo_actual").set({
        puestos: {
            ...takenNumbers,
            [selectedNumber]: { name: name, status: 'pendiente' }
        }
    }, { merge: true });
};

// Initialize
updateLotteryInfo();
initGrid();
syncRifa();
