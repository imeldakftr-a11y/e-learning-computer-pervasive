/* =====================================================================
   KONFIGURASI UJIAN
   ===================================================================== */
const EXAM_DURATION = 5 * 60;     // total waktu ujian (detik) -> 5 menit
const IDLE_THRESHOLD = 15;        // batas idle/AFK (detik) sebelum dianggap AFK
const MAX_TAB_VIOLATIONS = 3;     // batas maksimal pindah tab sebelum ujian dikunci

// =====================================================================
// DATA SOAL (silakan diganti sesuai materi kuliah Anda)
// Setiap soal punya: text, options (array string), correct (index jawaban benar)
// =====================================================================
const QUESTIONS = [
  {
    text: "Planet apa yang dikenal sebagai 'Planet Merah'?",
    options: [
      "Venus",
      "Mars",
      "Jupiter",
      "Saturnus"
    ],
    correct: 1
  },
  {
    text: "Siapa penemu lampu pijar yang banyak digunakan secara komersial?",
    options: [
      "Nikola Tesla",
      "Alexander Graham Bell",
      "Thomas Edison",
      "Albert Einstein"
    ],
    correct: 2
  },
  {
    text: "Gunung tertinggi di dunia adalah?",
    options: [
      "Gunung Kilimanjaro",
      "Gunung Everest",
      "Gunung Fuji",
      "Gunung Rinjani"
    ],
    correct: 1
  },
  {
    text: "Berapa jumlah provinsi di Indonesia saat ini?",
    options: [
      "33",
      "34",
      "37",
      "38"
    ],
    correct: 3
  },
  {
    text: "Mata uang resmi negara Jepang adalah?",
    options: [
      "Won",
      "Yuan",
      "Yen",
      "Ringgit"
    ],
    correct: 2
  }
];

/* =====================================================================
   STATE APLIKASI - menyimpan seluruh data selama ujian berjalan
   ===================================================================== */
const state = {
  name: '',
  nim: '',
  currentQuestion: 0,
  answers: new Array(QUESTIONS.length).fill(null), // jawaban user per soal
  timeLeft: EXAM_DURATION,
  timerInterval: null,

  // status pervasive
  isPaused: false,        // true jika ujian sedang dijeda karena AFK
  lastActivity: Date.now(),
  idleSeconds: 0,
  afkTotalSeconds: 0,
  isCurrentlyAfk: false,
  afkStartTime: null,

  tabViolations: 0,
  isLocked: false,

  examLog: [] // array of {time: "HH:MM:SS", message: "..."}
};

/* =====================================================================
   REFERENSI ELEMENT
   ===================================================================== */
const startScreen   = document.getElementById('startScreen');
const examScreen    = document.getElementById('examScreen');
const resultScreen  = document.getElementById('resultScreen');

const nameInput = document.getElementById('nameInput');
const nimInput  = document.getElementById('nimInput');
const startBtn  = document.getElementById('startBtn');

const progressLabel = document.getElementById('progressLabel');
const progressFill  = document.getElementById('progressFill');
const timerDisplay  = document.getElementById('timerDisplay');
const questionText  = document.getElementById('questionText');
const optionsContainer = document.getElementById('optionsContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

const presenceBadge = document.getElementById('presenceBadge');
const presenceText  = document.getElementById('presenceText');

const tabWarningOverlay = document.getElementById('tabWarningOverlay');
const tabWarningText    = document.getElementById('tabWarningText');
const tabWarningClose   = document.getElementById('tabWarningClose');

const lockOverlay      = document.getElementById('lockOverlay');
const lockOverlayClose = document.getElementById('lockOverlayClose');

const scoreNum       = document.getElementById('scoreNum');
const tabSwitchCount = document.getElementById('tabSwitchCount');
const afkTotalTime   = document.getElementById('afkTotalTime');
const logList        = document.getElementById('logList');
const restartBtn     = document.getElementById('restartBtn');

/* =====================================================================
   UTIL: mencatat log perilaku dengan timestamp
   ===================================================================== */
function logEvent(message){
  const now = new Date();
  const time = now.toLocaleTimeString('id-ID', { hour12:false });
  state.examLog.push({ time, message });
  console.log(`[LOG ${time}] ${message}`);
}

/* =====================================================================
   HALAMAN MULAI -> START
   ===================================================================== */
startBtn.addEventListener('click', () => {
  state.name = nameInput.value.trim() || 'Anonim';
  state.nim  = nimInput.value.trim() || '-';

  startScreen.classList.add('hidden');
  examScreen.classList.remove('hidden');
  presenceBadge.classList.remove('hidden');

  logEvent(`Ujian dimulai oleh ${state.name} (${state.nim})`);

  renderQuestion();
  startTimer();
  startIdleDetector();
  startTabMonitor();
});

/* =====================================================================
   RENDER SOAL
   ===================================================================== */
function renderQuestion(){
  const q = QUESTIONS[state.currentQuestion];
  questionText.textContent = q.text;

  progressLabel.textContent = `Soal ${state.currentQuestion + 1} dari ${QUESTIONS.length}`;
  progressFill.style.width = `${((state.currentQuestion + 1) / QUESTIONS.length) * 100}%`;

  optionsContainer.innerHTML = '';
  const letters = ['A','B','C','D','E'];

  q.options.forEach((optText, idx) => {
    const optEl = document.createElement('div');
    optEl.className = 'option';
    if(state.answers[state.currentQuestion] === idx){
      optEl.classList.add('selected');
    }
    optEl.innerHTML = `<span class="option-letter">${letters[idx]}</span><span>${optText}</span>`;
    optEl.addEventListener('click', () => selectAnswer(idx));
    optionsContainer.appendChild(optEl);
  });

  prevBtn.classList.toggle('hidden', state.currentQuestion === 0);
  nextBtn.textContent = (state.currentQuestion === QUESTIONS.length - 1) ? 'Selesai' : 'Selanjutnya';
}

function selectAnswer(idx){
  state.answers[state.currentQuestion] = idx;
  renderQuestion();
}

prevBtn.addEventListener('click', () => {
  if(state.currentQuestion > 0){
    state.currentQuestion--;
    renderQuestion();
  }
});

nextBtn.addEventListener('click', () => {
  if(state.currentQuestion < QUESTIONS.length - 1){
    state.currentQuestion++;
    renderQuestion();
  } else {
    finishExam('Ujian diselesaikan oleh pengguna.');
  }
});

/* =====================================================================
   FITUR 1: TAB VISIBILITY MONITOR (Anti-Cheating)
   Menggunakan Page Visibility API -> document.hidden / visibilitychange
   ===================================================================== */
function startTabMonitor(){
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function handleVisibilityChange(){
  if(state.isLocked) return;

  if(document.hidden){
    // Pengguna pindah ke tab/aplikasi lain
    state.tabViolations++;
    logEvent(`Pengguna berpindah tab/aplikasi lain (pelanggaran ke-${state.tabViolations})`);

    if(state.tabViolations >= MAX_TAB_VIOLATIONS){
      // Kunci ujian jika pelanggaran melebihi batas
      state.isLocked = true;
      logEvent('Ujian dikunci otomatis karena terlalu banyak pelanggaran tab.');
    }
  } else {
    // Pengguna kembali ke tab ujian
    if(state.isLocked){
      // tampilkan overlay lock saat kembali
      showLockOverlay();
    } else {
      logEvent('Pengguna kembali ke tab ujian.');
      showTabWarning();
    }
  }
}

function showTabWarning(){
  tabWarningText.textContent =
    `Perpindahan tab tercatat (${state.tabViolations}/${MAX_TAB_VIOLATIONS}). Sisa pelanggaran sebelum ujian dikunci: ${MAX_TAB_VIOLATIONS - state.tabViolations}.`;
  tabWarningOverlay.classList.add('show');
}

tabWarningClose.addEventListener('click', () => {
  tabWarningOverlay.classList.remove('show');
});

function showLockOverlay(){
  lockOverlay.classList.add('show');
}

lockOverlayClose.addEventListener('click', () => {
  lockOverlay.classList.remove('show');
  finishExam('Ujian dikunci karena pelanggaran tab melebihi batas.');
});

/* =====================================================================
   FITUR 2: IDLE / AFK DETECTOR (Presence Tracker)
   Mendengarkan event mousemove & keydown untuk mendeteksi aktivitas.
   Jika tidak ada aktivitas selama IDLE_THRESHOLD detik -> status AFK,
   timer ujian otomatis dipause.
   ===================================================================== */
function startIdleDetector(){
  ['mousemove', 'keydown', 'click', 'scroll'].forEach(evt => {
    document.addEventListener(evt, resetIdleTimer);
  });

  // cek setiap detik apakah user sudah idle terlalu lama
  setInterval(checkIdleStatus, 1000);
}

function resetIdleTimer(){
  state.lastActivity = Date.now();

  // jika sebelumnya AFK, sekarang user kembali aktif
  if(state.isCurrentlyAfk){
    const afkDuration = Math.floor((Date.now() - state.afkStartTime) / 1000);
    state.afkTotalSeconds += afkDuration;
    state.isCurrentlyAfk = false;
    state.isPaused = false;

    logEvent(`Pengguna kembali aktif setelah AFK selama ${afkDuration} detik.`);
    setPresence('focused');
    updateTimerDisplay();
  }
}

function checkIdleStatus(){
  if(state.isLocked) return;

  const idleSeconds = Math.floor((Date.now() - state.lastActivity) / 1000);

  if(idleSeconds >= IDLE_THRESHOLD && !state.isCurrentlyAfk){
    // pengguna baru terdeteksi AFK
    state.isCurrentlyAfk = true;
    state.afkStartTime = Date.now() - (IDLE_THRESHOLD * 1000);
    state.isPaused = true;

    logEvent(`Pengguna terdeteksi AFK (tidak ada aktivitas selama ${IDLE_THRESHOLD} detik). Timer dijeda.`);
    setPresence('afk');
    updateTimerDisplay();
  }
}

/* =====================================================================
   INDIKATOR PRESENCE (visual)
   ===================================================================== */
function setPresence(status){
  if(status === 'focused'){
    presenceBadge.className = 'presence-badge';
    presenceText.textContent = 'Focused';
  } else if(status === 'afk'){
    presenceBadge.className = 'presence-badge idle';
    presenceText.textContent = 'Away From Keyboard';
  } else if(status === 'away-tab'){
    presenceBadge.className = 'presence-badge danger';
    presenceText.textContent = 'Tab Tidak Aktif';
  }
}

/* =====================================================================
   TIMER UJIAN
   ===================================================================== */
function startTimer(){
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    if(state.isPaused || state.isLocked) return; // jangan kurangi waktu jika dipause/dikunci

    state.timeLeft--;
    updateTimerDisplay();

    if(state.timeLeft <= 0){
      finishExam('Waktu ujian habis.');
    }
  }, 1000);
}

function updateTimerDisplay(){
  const minutes = Math.floor(state.timeLeft / 60).toString().padStart(2,'0');
  const seconds = (state.timeLeft % 60).toString().padStart(2,'0');
  timerDisplay.textContent = `${minutes}:${seconds}`;
  timerDisplay.classList.toggle('paused', state.isPaused);
}

/* =====================================================================
   SELESAI UJIAN -> HITUNG SKOR & TAMPILKAN HASIL
   ===================================================================== */
function finishExam(reason){
  clearInterval(state.timerInterval);
  logEvent(`Ujian berakhir: ${reason}`);

  // jika user sedang AFK saat ujian berakhir, tambahkan durasi terakhir
  if(state.isCurrentlyAfk){
    const afkDuration = Math.floor((Date.now() - state.afkStartTime) / 1000);
    state.afkTotalSeconds += afkDuration;
  }

  // hitung skor
  let correctCount = 0;
  QUESTIONS.forEach((q, idx) => {
    if(state.answers[idx] === q.correct) correctCount++;
  });

  examScreen.classList.add('hidden');
  presenceBadge.classList.add('hidden');
  resultScreen.classList.remove('hidden');

  scoreNum.textContent = `${correctCount}/${QUESTIONS.length}`;
  tabSwitchCount.textContent = state.tabViolations;
  afkTotalTime.textContent = `${state.afkTotalSeconds}s`;

  // render log perilaku
  logList.innerHTML = '';
  state.examLog.forEach(entry => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="time">${entry.time}</span>${entry.message}`;
    logList.appendChild(li);
  });
}

/* =====================================================================
   ULANGI UJIAN -> reload halaman
   ===================================================================== */
restartBtn.addEventListener('click', () => {
  window.location.reload();
});