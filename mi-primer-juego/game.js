// ===================== CONFIGURACIÓN =====================
const TILE = 40;
const COLS = 12;
const WIDTH = TILE * COLS;    // 480
const HEIGHT = 720;
const START_COL = 6;
const START_ROW = 3;
const SCEN_LEN = 25;          // cada 25 puntos cambia el escenario
const WIN_SCORE = 100;        // al llegar aquí encuentra a su familia
const SAVE_KEY = 'luna_huesitos_total';
const SKIN_KEY = 'luna_skins';
const SETTINGS_KEY = 'luna_settings';

const config = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#9a9a9a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: { default: 'arcade' },
  scene: { preload: preload, create: create, update: update }
};
const game = new Phaser.Game(config);

let dog, cursors, cars, bonesGroup, rows, bestRow, hopping, gameOver, started;
let introOpen, bones, slowUntil, hud, queued, swipeStart;
let menuOpen = false, skinBtn = null, wObjs = [];
let pauseOpen = false, pauseBtn = null, frozen = false, freezeAt = 0;
let seenIntro = false;

// ---------- Huesitos acumulados (todas las partidas) ----------
function loadTotal() {
  try { return parseInt(localStorage.getItem(SAVE_KEY), 10) || 0; }
  catch (e) { return 0; }
}
function saveTotal() {
  try { localStorage.setItem(SAVE_KEY, String(totalBones)); } catch (e) {}
}
let totalBones = loadTotal();

// ---------- Skins guardadas ----------
function loadSkins() {
  try {
    const d = JSON.parse(localStorage.getItem(SKIN_KEY));
    if (d && Array.isArray(d.owned)) {
      const owned = d.owned.includes('clasica') ? d.owned : ['clasica'].concat(d.owned);
      const selected = owned.includes(d.selected) ? d.selected : 'clasica';
      return { owned: owned, selected: selected, spent: d.spent || 0 };
    }
  } catch (e) {}
  return { owned: ['clasica'], selected: 'clasica', spent: 0 };
}
function saveSkins() {
  try { localStorage.setItem(SKIN_KEY, JSON.stringify(skinData)); } catch (e) {}
}
let skinData = loadSkins();
function balance() { return Math.max(totalBones - skinData.spent, 0); }   // huesitos disponibles

// ---------- Ajustes (sonidos, música y vibración) ----------
function loadSettings() {
  const s = { sound: true, music: true, vibration: true };
  try {
    const d = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (d && typeof d === 'object') {
      s.sound = d.sound !== false;
      s.music = d.music !== false;
      s.vibration = d.vibration !== false;
    }
  } catch (e) {}
  return s;
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}
let settings = loadSettings();

function rowY(r) { return HEIGHT - TILE * (r + 1) + TILE / 2; }
function colX(c) { return c * TILE + TILE / 2; }
function score() { return bestRow - START_ROW; }
function level() { return 1 + Math.floor(score() / 10); }
function speedMult() { return Math.min(0.5 + score() * 0.025, 1.8); }
function scrollSpeed() { return Math.min(18 + score() * 0.45, 60); }

// ===================== AUDIO (generado por código, sin archivos) =====================
function ctxOf(scene) {
  const m = scene && scene.sound;
  return (m && m.context) ? m.context : null;
}

// Un "pitido" de oscilador. slide = frecuencia final (opcional).
function voice(ctx, dest, freq, start, dur, type, vol, slide) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, start);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, start + dur);
  g.gain.setValueAtTime(vol || 0.1, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(dest);
  o.start(start);
  o.stop(start + dur + 0.02);
}

// Ruido filtrado (choques, platillos)
let noiseBuf = null;
function noiseBuffer(ctx) {
  if (!noiseBuf) {
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noiseHit(ctx, dest, start, dur, vol, ftype, ffreq) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = ftype;
  f.frequency.value = ffreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(start);
  src.stop(start + dur + 0.02);
}

// Efectos de sonido
function sfx(scene, name) {
  const ctx = ctxOf(scene);
  if (!ctx || !settings.sound) return;
  if (ctx.state === 'suspended') ctx.resume();
  const d = ctx.destination;
  const t = ctx.currentTime;
  switch (name) {
    case 'hop':
      voice(ctx, d, 520, t, 0.07, 'square', 0.07, 780); break;
    case 'click':
      voice(ctx, d, 660, t, 0.05, 'square', 0.06); break;
    case 'bone':
      voice(ctx, d, 988, t, 0.07, 'square', 0.08);
      voice(ctx, d, 1319, t + 0.07, 0.12, 'square', 0.08); break;
    case 'buy':
      voice(ctx, d, 988, t, 0.06, 'square', 0.08);
      voice(ctx, d, 1319, t + 0.06, 0.14, 'square', 0.08); break;
    case 'nope':
      voice(ctx, d, 200, t, 0.15, 'square', 0.08, 140); break;
    case 'pothole':
      voice(ctx, d, 170, t, 0.2, 'sawtooth', 0.12, 70);
      noiseHit(ctx, d, t, 0.12, 0.08, 'lowpass', 500); break;
    case 'crash':
      noiseHit(ctx, d, t, 0.35, 0.2, 'lowpass', 1400);
      voice(ctx, d, 260, t, 0.35, 'sawtooth', 0.12, 60);
      voice(ctx, d, 392, t + 0.05, 0.3, 'square', 0.06);       // claxon
      voice(ctx, d, 494, t + 0.05, 0.3, 'square', 0.06); break;
    case 'scenario':
      [523, 659, 784, 1047].forEach((f, i) => voice(ctx, d, f, t + i * 0.09, 0.14, 'square', 0.07)); break;
    case 'win':
      [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => voice(ctx, d, f, t + i * 0.11, 0.2, 'square', 0.08)); break;
    case 'lose':
      voice(ctx, d, 400, t, 0.5, 'triangle', 0.12, 110); break;
  }
}

// Vibración (solo en dispositivos que la soportan)
function vibrate(pattern) {
  if (!settings.vibration) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

// Música: melodía alegre y juguetona en Do mayor (Do - Lam - Fa - Sol),
// con bajo, bombo, platillo y una campanita tipo estrella.
const BPM = 138;
const STEP = 60 / BPM / 2;                        // corchea
const MEL = [
  72, 0, 76, 0, 79, 76, 72, 0,                    // C
  69, 0, 72, 0, 76, 72, 69, 0,                    // Am
  65, 0, 69, 0, 72, 69, 65, 0,                    // F
  67, 0, 71, 0, 74, 71, 79, 0                     // G
];
const ROOTS = [48, 45, 41, 43];                   // bajo: C, A, F, G
const SPARK = [91, 88, 93, 86];                   // campanita por compás
let musicGain = null, musicTimer = null, nextNote = 0, musicStep = 0;

function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

function startMusic(scene) {
  const ctx = ctxOf(scene);
  if (!ctx || !settings.music || musicTimer) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.7;
    musicGain.connect(ctx.destination);
  }
  nextNote = ctx.currentTime + 0.1;
  musicTimer = setInterval(() => musicTick(ctx), 80);
}
function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}
function musicTick(ctx) {
  if (nextNote < ctx.currentTime - 0.3) nextNote = ctx.currentTime + 0.05;   // si la pestaña estuvo en segundo plano
  while (nextNote < ctx.currentTime + 0.3) {
    playStep(ctx, musicStep, nextNote);
    nextNote += STEP;
    musicStep = (musicStep + 1) % 32;
  }
}
function playStep(ctx, s, t) {
  const d = musicGain;
  const bar = Math.floor(s / 8);
  if (MEL[s]) voice(ctx, d, midi(MEL[s]), t, STEP * 1.6, 'square', 0.05);
  if (s % 2 === 0) voice(ctx, d, midi(ROOTS[bar] + (s % 4 === 0 ? 0 : 7)), t, STEP * 1.7, 'triangle', 0.12);
  if (s % 4 === 0) voice(ctx, d, 150, t, 0.1, 'sine', 0.18, 45);
  if (s % 2 === 1) noiseHit(ctx, d, t, 0.04, 0.035, 'highpass', 7000);
  if (s % 8 === 3) voice(ctx, d, midi(SPARK[bar]), t, 0.25, 'sine', 0.035);
}

// ===================== ESCENARIOS =====================
const SCENARIOS = [
  { name: 'Sierra · Av. Simón Bolívar', msg: 'Quito huele a lluvia y gasolina...',
    ground: [0xa3a3a3, 0x969696], road: 0x3a3a3a, dashes: true, potholes: true,
    decor: ['tree', 'lamp'], lanes: ['taxi', 'taxi', 'carRed', 'carWhite', 'busBlue', 'busGreen', 'truck'] },
  { name: 'Costa', msg: '¡Huele a mar! El rastro sigue...',
    ground: [0xe6d6a0, 0xdccb92], road: 0x4a4a4a, dashes: true, potholes: true,
    decor: ['palm'], lanes: ['moto', 'moto', 'taxi', 'carRed', 'carWhite', 'truck', 'busBlue'] },
  { name: 'Amazonía', msg: 'Lodo, selva y caminos de tierra...',
    ground: [0x4f9d4f, 0x448f44], road: 0x6b4f3a, dashes: false, potholes: true,
    decor: ['tree'], lanes: ['truck', 'moto', 'carWhite', 'busGreen'] },
  { name: 'Galápagos', msg: '¡Casi llegas! Su familia está en la playa.',
    ground: [0xf2e7b8, 0xeadfaa], road: 0xc8b878, dashes: false, potholes: false,
    decor: ['palm'], lanes: ['turtle', 'turtle', 'sealion'] }
];
function scenarioOf(r) {
  const i = Math.floor(Math.max(r - START_ROW, 0) / SCEN_LEN);
  return SCENARIOS[Math.min(i, SCENARIOS.length - 1)];
}

const LANE_INFO = {
  taxi:     { n: 3, min: 140, max: 230 },
  carRed:   { n: 3, min: 120, max: 210 },
  carWhite: { n: 3, min: 120, max: 210 },
  moto:     { n: 3, min: 200, max: 300 },
  busBlue:  { n: 2, min: 70,  max: 120 },
  busGreen: { n: 2, min: 70,  max: 120 },
  truck:    { n: 2, min: 60,  max: 110 },
  turtle:   { n: 2, min: 25,  max: 50 },
  sealion:  { n: 3, min: 60,  max: 110 }
};

// ===================== PERRITA PIXEL ART =====================
const DOG_PIXELS = [
  '...KKKKKKKKKK...',
  '...KWWWWWWWWK...',
  '.KKKWWWWWWWWKKK.',
  'KWWKWWWWWWWWKWWK',
  'KWWKWKWWWWKWKWWK',
  'KWWKWKWWWWKWKWWK',
  'KGGKCWKKKKWCKGGK',
  'KGGKWWWKKWWWKGGK',
  '.KKKWWWPPWWWKKK.',
  '...KKKKKKKKKK...',
  '..KKGGGGGGGGKK..',
  '...KWWWWWWWWK...',
  '...KWWWWWWWWK...',
  '...KWWWKKWWWK...',
  '...KWWWKKWWWK...',
  '...KKKKKKKKKK...'
];
const PALETTE = { K: 0x111111, W: 0xffffff, G: 0xd0d4d4, P: 0xf0707f, C: 0xf5c9b0 };

// ===================== SKINS =====================
// overlay: filas del dibujo (0 a 15) que se pintan encima de Luna. '.' = transparente.
const SKINS = [
  { id: 'clasica', name: 'Luna clásica', theme: 'Su look de siempre', cost: 0,
    overlay: null, palette: {} },
  { id: 'bufanda', name: 'Bufanda andina', theme: 'Sierra', cost: 10,
    palette: { R: 0xd63a3a, Y: 0xf6c90e },
    overlay: { 9: '...RRRRRRRRRR...', 10: '..RRYRRYRRYRRR..', 11: '....RR..........', 12: '....RR..........' } },
  { id: 'playa', name: 'Gorro de playa', theme: 'Costa', cost: 25,
    palette: { S: 0xe8c872, B: 0x1e88e5 },
    overlay: { 0: '.....SSSSSS.....', 1: '....SBBBBBBS....', 2: '.SSSSSSSSSSSSSS.' } },
  { id: 'safari', name: 'Sombrero safari', theme: 'Amazonía', cost: 45,
    palette: { T: 0xc2a878, M: 0x6b4f3a },
    overlay: { 0: '....TTTTTTTT....', 1: '...MMMMMMMMMM...', 2: '.TTTTTTTTTTTTTT.' } },
  { id: 'snorkel', name: 'Gafas de buceo', theme: 'Galápagos', cost: 70,
    palette: { F: 0x1e88e5, L: 0xa8dcff },
    overlay: { 3: '....FFFFFFFF....', 4: '....FKLFFLKF....', 5: '....FKLFFLKF....' } }
];

function makePixelTexture(scene, key, grid, palette, px) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (palette[ch] !== undefined) {
        g.fillStyle(palette[ch]);
        g.fillRect(x * px, y * px, px, px);
      }
    });
  });
  g.generateTexture(key, grid[0].length * px, grid.length * px);
  g.destroy();
}

function makeSkinTexture(scene, skin) {
  const grid = DOG_PIXELS.map(r => r.split(''));
  if (skin.overlay) {
    Object.keys(skin.overlay).forEach(k => {
      const line = skin.overlay[k];
      for (let x = 0; x < line.length; x++) {
        if (line[x] !== '.') grid[+k][x] = line[x];
      }
    });
  }
  const palette = Object.assign({}, PALETTE, skin.palette);
  makePixelTexture(scene, 'dog_' + skin.id, grid.map(r => r.join('')), palette, 2);
}

// ===================== VEHÍCULOS Y ANIMALES =====================
function makeVehicleTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const done = (key, w, h) => { g.generateTexture(key, w, h); g.clear(); };
  const wheel = (x, y) => {
    g.fillStyle(0x111111); g.fillRect(x, y, 10, 8);
    g.fillStyle(0x888888); g.fillRect(x + 3, y + 2, 4, 4);
  };

  const car = (key, color, dark, sign) => {
    g.fillStyle(color); g.fillRect(0, 12, 52, 20); g.fillRect(12, 4, 28, 10);
    g.fillStyle(dark);  g.fillRect(0, 26, 52, 4);
    if (sign) { g.fillStyle(0x222222); g.fillRect(21, 0, 10, 4); }
    g.fillStyle(0xa8dcff); g.fillRect(14, 6, 10, 7); g.fillRect(28, 6, 10, 7);
    g.fillStyle(0xffffff); g.fillRect(48, 18, 4, 4);
    wheel(6, 30); wheel(36, 30);
    done(key, 52, 40);
  };
  car('taxi', 0xf6c90e, 0xd4a900, true);
  car('carRed', 0xd63a3a, 0xa02727, false);
  car('carWhite', 0xf2f2f2, 0xc5c9cc, false);

  g.fillStyle(0x111111); g.fillRect(2, 28, 10, 10); g.fillRect(24, 28, 10, 10);
  g.fillStyle(0x888888); g.fillRect(5, 31, 4, 4); g.fillRect(27, 31, 4, 4);
  g.fillStyle(0xe53935); g.fillRect(8, 22, 22, 8);
  g.fillStyle(0x222222); g.fillRect(26, 18, 6, 6);
  g.fillStyle(0x2c3e50); g.fillRect(10, 8, 12, 14);
  g.fillStyle(0xffe066); g.fillRect(12, 2, 10, 8);
  done('moto', 36, 40);

  const bus = (key, color, dark) => {
    g.fillStyle(color); g.fillRect(0, 4, 120, 30);
    g.fillStyle(dark);  g.fillRect(0, 26, 120, 8);
    g.fillStyle(0xffffff); g.fillRect(0, 22, 120, 2);
    g.fillStyle(0xa8dcff);
    for (let x = 8; x < 92; x += 18) g.fillRect(x, 9, 12, 10);
    g.fillRect(100, 9, 16, 14);
    g.fillStyle(0xffe066); g.fillRect(116, 27, 4, 4);
    wheel(14, 30); wheel(88, 30);
    done(key, 120, 40);
  };
  bus('busBlue', 0x2f6fdb, 0x1f4fa3);
  bus('busGreen', 0x2fb35a, 0x1f8040);

  g.fillStyle(0xffffff); g.fillRect(0, 4, 72, 30);
  g.fillStyle(0xcfd8dc); g.fillRect(0, 28, 72, 6);
  g.fillStyle(0xb0bec5); g.fillRect(0, 4, 72, 2);
  g.fillStyle(0xf5f5f5); g.fillRect(74, 12, 30, 22);
  g.fillStyle(0xcfd8dc); g.fillRect(74, 28, 30, 6);
  g.fillStyle(0xa8dcff); g.fillRect(90, 15, 12, 9);
  g.fillStyle(0xffe066); g.fillRect(100, 27, 4, 4);
  wheel(8, 30); wheel(50, 30); wheel(82, 30);
  done('truck', 104, 40);

  g.fillStyle(0x556b2f); g.fillRect(8, 6, 64, 26);
  g.fillStyle(0x6b8e23); g.fillRect(14, 4, 52, 8);
  g.fillStyle(0x4b5d23); g.fillRect(20, 14, 12, 8); g.fillRect(40, 14, 12, 8);
  g.fillStyle(0x8a9a5b); g.fillRect(72, 16, 12, 10); g.fillRect(12, 30, 10, 6); g.fillRect(54, 30, 10, 6);
  g.fillStyle(0x111111); g.fillRect(80, 18, 2, 2);
  done('turtle', 84, 40);

  g.fillStyle(0x7a5c3e); g.fillRect(0, 14, 44, 18); g.fillRect(40, 8, 14, 14);
  g.fillStyle(0x5c4429); g.fillRect(14, 30, 12, 6);
  g.fillStyle(0x111111); g.fillRect(48, 12, 3, 3); g.fillRect(53, 16, 3, 3);
  done('sealion', 56, 40);

  g.destroy();
}

// ===================== DECORADO, BACHES, CONOS Y HUESITOS =====================
function makeScenery(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const done = (key) => { g.generateTexture(key, TILE, TILE); g.clear(); };

  g.fillStyle(0x5d4037); g.fillRect(16, 26, 8, 12);
  g.fillStyle(0x2e8b57); g.fillRect(6, 8, 28, 20);
  g.fillStyle(0x3cb371); g.fillRect(12, 2, 16, 8); g.fillRect(8, 10, 8, 6);
  done('tree');

  g.fillStyle(0x555555); g.fillRect(18, 10, 4, 28); g.fillRect(12, 6, 16, 6);
  g.fillStyle(0xfff3a0); g.fillRect(14, 12, 12, 3);
  done('lamp');

  g.fillStyle(0x8d6e63); g.fillRect(18, 16, 5, 22);
  g.fillStyle(0x2e8b57); g.fillRect(6, 8, 28, 5); g.fillRect(12, 4, 16, 5);
  g.fillRect(4, 12, 8, 5); g.fillRect(28, 12, 8, 5);
  done('palm');

  g.fillStyle(0xff7a00); g.fillTriangle(20, 6, 10, 34, 30, 34);
  g.fillStyle(0xffffff); g.fillRect(14, 20, 12, 4);
  g.fillStyle(0x333333); g.fillRect(8, 34, 24, 4);
  done('cone');

  g.fillStyle(0x222222); g.fillEllipse(20, 20, 30, 18);
  g.fillStyle(0x0d0d0d); g.fillEllipse(20, 21, 22, 12);
  done('pothole');

  g.fillStyle(0x000000, 0.25); g.fillEllipse(20, 30, 26, 6);
  g.fillStyle(0xfff4d6); g.fillRect(10, 17, 20, 6);
  g.fillCircle(10, 16, 4); g.fillCircle(10, 24, 4);
  g.fillCircle(30, 16, 4); g.fillCircle(30, 24, 4);
  done('bone');

  g.destroy();
}

// ===================== PHASER =====================
function preload() {
  SKINS.forEach(s => makeSkinTexture(this, s));
  makeVehicleTextures(this);
  makeScenery(this);
}

function create() {
  rows = [];
  bestRow = START_ROW;
  hopping = false;
  gameOver = false;
  started = false;
  bones = 0;
  slowUntil = 0;
  queued = null;
  swipeStart = null;
  menuOpen = false;
  pauseOpen = false;
  frozen = false;
  skinBtn = null;
  pauseBtn = null;
  wObjs = [];
  introOpen = !seenIntro;

  cars = this.physics.add.group({ allowGravity: false });
  bonesGroup = this.physics.add.group({ allowGravity: false });

  for (let r = 0; r < 28; r++) addRow(this, r);

  dog = this.physics.add.image(colX(START_COL), rowY(START_ROW), 'dog_' + skinData.selected).setDepth(3);
  dog.body.setSize(20, 20);

  cursors = this.input.keyboard.createCursorKeys();

  // Pausa con ESC o P
  const togglePause = () => {
    if (introOpen || gameOver) return;
    if (pauseOpen) closePause(this);
    else if (!menuOpen) openPause(this);
  };
  this.input.keyboard.on('keydown-ESC', togglePause);
  this.input.keyboard.on('keydown-P', togglePause);

  // Controles táctiles: tocar = adelante, deslizar = hacia ese lado
  this.input.on('pointerdown', (p, over) => {
    const blocked = introOpen || gameOver || menuOpen || (over && over.length > 0);
    swipeStart = blocked ? null : { x: p.x, y: p.y };
  });
  this.input.on('pointerup', p => {
    if (!swipeStart) return;
    const dx = p.x - swipeStart.x;
    const dy = p.y - swipeStart.y;
    swipeStart = null;
    if (introOpen || gameOver || menuOpen) return;
    if (Math.abs(dx) < 25 && Math.abs(dy) < 25) queued = [0, -1];
    else if (Math.abs(dx) > Math.abs(dy)) queued = [dx > 0 ? 1 : -1, 0];
    else queued = [0, dy > 0 ? 1 : -1];
  });

  hud = this.add.text(10, 10, '', {
    fontSize: '18px', color: '#ffffff', stroke: '#000000', strokeThickness: 4, lineSpacing: 4
  }).setScrollFactor(0).setDepth(10);
  updateHud();

  this.physics.add.overlap(dog, cars, hitCar, null, this);
  this.physics.add.overlap(dog, bonesGroup, (d, b) => {
    b.destroy();
    bones++;
    totalBones++;
    saveTotal();
    updateHud();
    sfx(this, 'bone');
    vibrate(20);
  });

  if (introOpen) showIntro(this); else afterIntro(this);
}

function updateHud() {
  hud.setText('Puntos: ' + score() + '   Nivel: ' + level() +
              '\n🦴 ' + bones + '   (total: ' + totalBones + ')' +
              '\n' + scenarioOf(bestRow).name);
}

function afterIntro(scene) {
  makePauseBtn(scene);
  makeSkinBtn(scene);
  startMusic(scene);
  showBanner(scene, SCENARIOS[0]);
}

// Congela el juego mientras hay un menú abierto
function freeze(scene) {
  if (frozen) return;
  frozen = true;
  freezeAt = scene.time.now;
  scene.physics.pause();
  scene.tweens.pauseAll();
}
function unfreeze(scene) {
  if (!frozen) return;
  frozen = false;
  if (slowUntil) slowUntil += scene.time.now - freezeAt;   // el bache no se acaba durante la pausa
  if (!gameOver) scene.physics.resume();
  scene.tweens.resumeAll();
}

// Espera ESPACIO o un toque en la pantalla
function onContinue(scene, fn, delay) {
  scene.time.delayedCall(delay || 0, () => {
    let done = false;
    const go = () => { if (done) return; done = true; fn(); };
    scene.input.keyboard.once('keydown-SPACE', go);
    scene.input.once('pointerup', go);
  });
}

function makeButton(scene, x, y, label, color, size) {
  const b = scene.add.text(x, y, label, {
    fontSize: (size || 22) + 'px', color: '#ffffff', backgroundColor: color,
    padding: { x: 14, y: 8 }
  }).setOrigin(0.5).setScrollFactor(0).setInteractive({ useHandCursor: true });
  b.on('pointerup', () => sfx(scene, 'click'));
  return b;
}

// ---------- Narrativa ----------
function showIntro(scene) {
  const bg = scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0f172a, 0.95)
    .setScrollFactor(0).setDepth(20);
  const title = scene.add.text(WIDTH / 2, 90, 'LUNA CRUZA ECUADOR', {
    fontSize: '30px', color: '#ffe066', align: 'center', fontStyle: 'bold',
    wordWrap: { width: WIDTH - 40 }
  }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
  const t = scene.add.text(WIDTH / 2, HEIGHT / 2 + 10,
    'Luna se quedó sola en Quito mientras su familia viajó a Galápagos.\n\n' +
    'Huele su rastro y cruzará todo el país para encontrarlos. 🐶\n\n' +
    'Flechas del teclado o desliza el dedo para saltar.\n\n' +
    'Junta huesitos 🦴 y úsalos para desbloquear skins.\n\n' +
    'ESC o el botón ⏸ para pausar.\n\n' +
    'Presiona ESPACIO o toca la pantalla para empezar',
    { fontSize: '20px', color: '#f4f4f0', align: 'center', lineSpacing: 4,
      wordWrap: { width: WIDTH - 60 } })
    .setOrigin(0.5).setScrollFactor(0).setDepth(21);
  onContinue(scene, () => {
    bg.destroy(); title.destroy(); t.destroy();
    seenIntro = true; introOpen = false;
    sfx(scene, 'click');
    afterIntro(scene);
  });
}

function showBanner(scene, s) {
  const t = scene.add.text(WIDTH / 2, 170, s.name + '\n' + s.msg, {
    fontSize: '22px', color: '#ffe066', align: 'center', stroke: '#000000', strokeThickness: 5,
    wordWrap: { width: WIDTH - 40 }
  }).setOrigin(0.5).setScrollFactor(0).setDepth(15);
  scene.tweens.add({ targets: t, alpha: 0, delay: 2200, duration: 800, onComplete: () => t.destroy() });
}

function floatText(scene, msg) {
  const t = scene.add.text(dog.x, dog.y - 30, msg, {
    fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
  }).setOrigin(0.5).setDepth(12);
  scene.tweens.add({ targets: t, y: t.y - 40, alpha: 0, duration: 900, onComplete: () => t.destroy() });
}

// ---------- Botones superiores ----------
function makePauseBtn(scene) {
  pauseBtn = makeButton(scene, WIDTH - 30, 34, '⏸', '#475569', 22).setDepth(10);
  pauseBtn.on('pointerup', () => {
    if (introOpen || gameOver || menuOpen) return;
    openPause(scene);
  });
}

// Botón de skins (solo antes del primer salto)
function makeSkinBtn(scene) {
  skinBtn = makeButton(scene, WIDTH - 112, 34, '👗 Skins', '#7c3aed', 18).setDepth(10);
  skinBtn.on('pointerup', () => openWardrobe(scene));
}

// ---------- Menú de pausa ----------
function openPause(scene) {
  if (menuOpen) return;
  pauseOpen = true;
  menuOpen = true;
  freeze(scene);
  renderPause(scene);
}

function closePause(scene) {
  wObjs.forEach(o => o.destroy());
  wObjs = [];
  pauseOpen = false;
  menuOpen = false;
  unfreeze(scene);
}

function renderPause(scene) {
  wObjs.forEach(o => o.destroy());
  wObjs = [];
  const add = o => { o.setScrollFactor(0); wObjs.push(o); return o; };
  const later = fn => () => scene.time.delayedCall(0, fn);

  add(scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0f172a, 0.96)
    .setDepth(30).setInteractive());
  add(scene.add.text(WIDTH / 2, 110, '⏸ PAUSA', {
    fontSize: '34px', color: '#ffe066', fontStyle: 'bold'
  }).setOrigin(0.5).setDepth(31));
  add(scene.add.text(WIDTH / 2, 160, 'Puntos: ' + score() + '   🦴 ' + bones, {
    fontSize: '20px', color: '#ffffff'
  }).setOrigin(0.5).setDepth(31));

  const btn = (y, label, color, fn) => {
    const b = add(makeButton(scene, WIDTH / 2, y, label, color, 24).setDepth(31));
    b.on('pointerup', later(fn));
  };
  const onOff = v => (v ? 'SÍ' : 'NO');
  const col = v => (v ? '#1e88e5' : '#475569');

  btn(250, '▶ Continuar', '#2e7d32', () => closePause(scene));

  btn(340, '🔊 Sonidos: ' + onOff(settings.sound), col(settings.sound), () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) sfx(scene, 'click');
    renderPause(scene);
  });

  btn(410, '🎵 Música: ' + onOff(settings.music), col(settings.music), () => {
    settings.music = !settings.music;
    saveSettings();
    if (settings.music) startMusic(scene); else stopMusic();
    renderPause(scene);
  });

  btn(480, '📳 Vibración: ' + onOff(settings.vibration), col(settings.vibration), () => {
    settings.vibration = !settings.vibration;
    saveSettings();
    vibrate(60);
    renderPause(scene);
  });

  if (!navigator.vibrate) {
    add(scene.add.text(WIDTH / 2, 530, 'Este dispositivo no soporta vibración.', {
      fontSize: '15px', color: '#94a3b8', align: 'center'
    }).setOrigin(0.5).setDepth(31));
  }

  btn(610, '↺ Reiniciar partida', '#b45309', () => {
    closePause(scene);
    scene.scene.restart();
  });
}

// ---------- Armario ----------
function openWardrobe(scene) {
  if (menuOpen) return;
  menuOpen = true;
  freeze(scene);
  renderWardrobe(scene, '');
}

function closeWardrobe(scene) {
  wObjs.forEach(o => o.destroy());
  wObjs = [];
  menuOpen = false;
  unfreeze(scene);
}

function renderWardrobe(scene, msg) {
  wObjs.forEach(o => o.destroy());
  wObjs = [];
  const add = o => { o.setScrollFactor(0); wObjs.push(o); return o; };

  add(scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0f172a, 0.98)
    .setDepth(30).setInteractive());
  add(scene.add.text(WIDTH / 2, 40, 'ARMARIO DE LUNA', {
    fontSize: '28px', color: '#ffe066', fontStyle: 'bold'
  }).setOrigin(0.5).setDepth(31));
  add(scene.add.text(WIDTH / 2, 78, '🦴 Disponibles: ' + balance(), {
    fontSize: '20px', color: '#ffffff'
  }).setOrigin(0.5).setDepth(31));

  SKINS.forEach((s, i) => {
    const y = 150 + i * 100;
    const owned = skinData.owned.includes(s.id);
    const equipped = skinData.selected === s.id;
    const missing = s.cost - balance();

    const card = add(scene.add.rectangle(WIDTH / 2, y, 440, 86, equipped ? 0x1b5e20 : 0x1e293b)
      .setStrokeStyle(2, equipped ? 0xffe066 : 0x475569)
      .setDepth(31).setInteractive({ useHandCursor: true }));
    add(scene.add.image(70, y, 'dog_' + s.id).setScale(1.8).setDepth(32));
    add(scene.add.text(118, y - 24, s.name, { fontSize: '20px', color: '#ffffff' }).setDepth(32));
    add(scene.add.text(118, y + 4, s.theme, { fontSize: '15px', color: '#94a3b8' }).setDepth(32));

    let status, col;
    if (equipped) { status = 'Puesta ✔'; col = '#ffe066'; }
    else if (owned) { status = 'Equipar'; col = '#86efac'; }
    else if (missing <= 0) { status = '🦴 ' + s.cost + ' · Comprar'; col = '#86efac'; }
    else { status = '🦴 ' + s.cost + ' (faltan ' + missing + ')'; col = '#fca5a5'; }
    add(scene.add.text(WIDTH / 2 + 210, y + 22, status, { fontSize: '15px', color: col })
      .setOrigin(1, 0.5).setDepth(32));

    card.on('pointerup', () => {
      let text = '';
      if (!owned) {
        if (balance() < s.cost) {
          sfx(scene, 'nope');
          text = 'Te faltan ' + (s.cost - balance()) + ' huesitos para ' + s.name;
          scene.time.delayedCall(0, () => renderWardrobe(scene, text));
          return;
        }
        skinData.spent += s.cost;
        skinData.owned.push(s.id);
        text = '¡Desbloqueaste ' + s.name + '!';
        sfx(scene, 'buy');
      } else {
        sfx(scene, 'click');
      }
      skinData.selected = s.id;
      saveSkins();
      dog.setTexture('dog_' + s.id);
      scene.time.delayedCall(0, () => renderWardrobe(scene, text));
    });
  });

  add(scene.add.text(WIDTH / 2, 622, msg, {
    fontSize: '17px', color: '#ffe066', align: 'center', wordWrap: { width: WIDTH - 40 }
  }).setOrigin(0.5).setDepth(31));

  const close = add(makeButton(scene, WIDTH / 2, 676, '✖ Cerrar', '#475569', 20).setDepth(31));
  close.on('pointerup', () => scene.time.delayedCall(0, () => closeWardrobe(scene)));
}

// ---------- Pantalla final ----------
function endScreen(scene, msg) {
  if (pauseBtn) { pauseBtn.destroy(); pauseBtn = null; }
  scene.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x0f172a, 0.85)
    .setScrollFactor(0).setDepth(20);
  scene.add.text(WIDTH / 2, HEIGHT / 2 - 70,
    msg + '\n\nPuntos: ' + score() + '\n🦴 ' + bones + '   (total: ' + totalBones + ')',
    { fontSize: '24px', color: '#ffffff', align: 'center', lineSpacing: 6,
      wordWrap: { width: WIDTH - 60 } })
    .setOrigin(0.5).setScrollFactor(0).setDepth(21);

  // pequeña pausa para no reiniciar por accidente
  scene.time.delayedCall(600, () => {
    const play = makeButton(scene, WIDTH / 2, HEIGHT / 2 + 150, '▶ Jugar otra vez', '#2e7d32', 24).setDepth(22);
    const skins = makeButton(scene, WIDTH / 2, HEIGHT / 2 + 215, '👗 Skins', '#7c3aed', 22).setDepth(22);
    play.on('pointerup', () => scene.scene.restart());
    skins.on('pointerup', () => openWardrobe(scene));
    scene.input.keyboard.on('keydown-SPACE', () => { if (!menuOpen) scene.scene.restart(); });
  });
}

function win(scene) {
  if (gameOver) return;
  gameOver = true;
  scene.physics.pause();
  sfx(scene, 'win');
  vibrate([60, 40, 60, 40, 120]);
  endScreen(scene, '¡Luna encontró a su familia en Galápagos! 🐶❤️\n\nFIN');
}

function caught(scene) {
  if (gameOver) return;
  gameOver = true;
  scene.physics.pause();
  sfx(scene, 'lose');
  vibrate(150);
  endScreen(scene, '¡Te quedaste atrás!\nLuna perdió el rastro...');
}

function hitCar() {
  if (gameOver) return;
  gameOver = true;
  this.physics.pause();
  dog.setTint(0xff6666).setScale(1.3, 0.4);
  sfx(this, 'crash');
  vibrate(250);
  endScreen(this, '¡Oh no!\nLuna se perdió otra vez...');
}

// ---------- Mundo ----------
function addRow(scene, r) {
  const y = rowY(r);
  const sc = scenarioOf(r);
  const safe = r <= START_ROW + 1;
  const isRoad = !safe && Math.random() < 0.55;
  const closed = isRoad && r > START_ROW + 3 && Math.random() < 0.12;
  rows[r] = { type: isRoad ? 'road' : 'sidewalk', blocked: new Set(), potholes: new Set() };

  const color = isRoad ? sc.road : sc.ground[r % 2];
  scene.add.rectangle(WIDTH / 2, y, WIDTH, TILE, color).setDepth(0);

  if (isRoad) {
    if (sc.dashes && rows[r - 1] && rows[r - 1].type === 'road') {
      for (let x = 0; x < WIDTH; x += 40) {
        scene.add.rectangle(x + 20, y + TILE / 2, 20, 3, 0xf2f2f2).setDepth(0.5);
      }
    }

    if (closed) {
      for (let i = 0; i < 4; i++) {
        scene.add.image(colX(Phaser.Math.Between(0, COLS - 1)), y, 'cone').setDepth(1);
      }
    } else {
      const type = Phaser.Utils.Array.GetRandom(sc.lanes);
      const info = LANE_INFO[type];
      const dir = Math.random() < 0.5 ? 1 : -1;
      const speed = Phaser.Math.Between(info.min, info.max);
      const slot = WIDTH / info.n;

      for (let i = 0; i < info.n; i++) {
        const car = cars.create(0, y, type).setDepth(1);
        car.x = i * slot + car.width / 2 + Phaser.Math.Between(0, slot - car.width);
        car.setFlipX(dir < 0);
        car.setData({ dir: dir, speed: speed });
        car.setVelocityX(dir * speed * speedMult());
        car.body.setSize(car.width - 8, 26);
      }

      if (sc.potholes && Math.random() < 0.3) {
        const count = Phaser.Math.Between(1, 2);
        for (let i = 0; i < count; i++) {
          const col = Phaser.Math.Between(0, COLS - 1);
          rows[r].potholes.add(col);
          scene.add.image(colX(col), y, 'pothole').setDepth(0.6);
        }
      }
    }
  } else if (r > START_ROW) {
    const count = Phaser.Math.Between(1, 3);
    for (let i = 0; i < count; i++) {
      const col = Phaser.Math.Between(0, COLS - 1);
      if (col === START_COL || rows[r].blocked.has(col)) continue;
      rows[r].blocked.add(col);
      scene.add.image(colX(col), y, Phaser.Math.RND.pick(sc.decor)).setDepth(1);
    }
    if (Math.random() < 0.35) {
      const col = Phaser.Math.Between(0, COLS - 1);
      if (!rows[r].blocked.has(col)) {
        bonesGroup.create(colX(col), y, 'bone').setDepth(1);
      }
    }
  }
}

function hop(scene, dx, dy) {
  const nx = dog.x + dx * TILE;
  const ny = dog.y + dy * TILE;
  if (nx < 0 || nx > WIDTH) return;
  if (ny + TILE / 2 > scene.cameras.main.scrollY + HEIGHT) return;

  const col = Math.round((nx - TILE / 2) / TILE);
  const row = Math.round((rowY(0) - ny) / TILE);
  if (rows[row] && rows[row].blocked.has(col)) return;

  hopping = true;
  started = true;
  if (skinBtn) { skinBtn.destroy(); skinBtn = null; }   // ya empezó la partida
  sfx(scene, 'hop');
  const slow = scene.time.now < slowUntil;
  scene.tweens.add({
    targets: dog, x: nx, y: ny, duration: slow ? 300 : 110, ease: 'Quad.easeOut',
    onComplete: () => { hopping = false; checkPothole(scene, row, col); }
  });

  if (row > bestRow) {
    bestRow = row;
    updateHud();
    while (rows.length < row + 28) addRow(scene, rows.length);
    const s = score();
    if (s > 0 && s % SCEN_LEN === 0 && s < WIN_SCORE) {
      showBanner(scene, scenarioOf(row));
      sfx(scene, 'scenario');
    }
    if (s >= WIN_SCORE) win(scene);
  }
}

function checkPothole(scene, row, col) {
  if (gameOver) return;
  if (rows[row] && rows[row].potholes.has(col) && scene.time.now >= slowUntil) {
    slowUntil = scene.time.now + 3000;
    dog.setTint(0xb5a37a);
    floatText(scene, '¡Bache!');
    sfx(scene, 'pothole');
    vibrate(80);
  }
}

function update() {
  if (gameOver || introOpen || menuOpen) return;
  const cam = this.cameras.main;
  const mult = speedMult();

  cars.getChildren().forEach(car => {
    if (car.y > cam.scrollY + HEIGHT + 200) { car.destroy(); return; }
    const dir = car.getData('dir');
    car.setVelocityX(dir * car.getData('speed') * mult);
    const margin = car.width / 2 + 10;
    if (dir > 0 && car.x > WIDTH + margin) car.x = -margin;
    else if (dir < 0 && car.x < -margin) car.x = WIDTH + margin;
  });

  if (started) cam.scrollY -= scrollSpeed() * this.game.loop.delta / 1000;
  const target = dog.y - HEIGHT * 0.6;
  if (target < cam.scrollY) cam.scrollY = Phaser.Math.Linear(cam.scrollY, target, 0.1);

  if (slowUntil && this.time.now >= slowUntil) { dog.clearTint(); slowUntil = 0; }

  if (dog.y > cam.scrollY + HEIGHT) { caught(this); return; }

  if (!hopping) {
    if (queued) {
      const q = queued; queued = null;
      hop(this, q[0], q[1]);
    }
    else if (Phaser.Input.Keyboard.JustDown(cursors.up))    hop(this, 0, -1);
    else if (Phaser.Input.Keyboard.JustDown(cursors.down))  hop(this, 0, 1);
    else if (Phaser.Input.Keyboard.JustDown(cursors.left))  hop(this, -1, 0);
    else if (Phaser.Input.Keyboard.JustDown(cursors.right)) hop(this, 1, 0);
  }
}