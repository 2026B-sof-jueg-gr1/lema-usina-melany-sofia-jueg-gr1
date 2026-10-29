// ===================== CONFIGURACIÓN =====================
const TILE = 40;              // tamaño de cada casilla
const COLS = 12;
const WIDTH = TILE * COLS;    // 480
const HEIGHT = 640;
const START_COL = 6;

const config = {
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#9a9a9a',
  pixelArt: true,             // mantiene el pixel art nítido
  physics: { default: 'arcade' },
  scene: { preload: preload, create: create, update: update }
};
const game = new Phaser.Game(config);

let dog, cursors, cars, rows, bestRow, hopping, gameOver, scoreText;

// y del centro de la fila r (la fila 0 es la de abajo) y x del centro de la columna c
function rowY(r) { return HEIGHT - TILE * (r + 1) + TILE / 2; }
function colX(c) { return c * TILE + TILE / 2; }

// Dificultad: empieza lento (x0.5) y sube con el puntaje hasta x1.8
function speedMult() { return Math.min(0.5 + bestRow * 0.025, 1.8); }
function levelNow() { return 1 + Math.floor(bestRow / 10); }   // sube cada 10 puntos

// ===================== PERRITO PIXEL ART =====================
// K = negro, W = blanco, G = gris claro, P = lengua, C = mejillas, . = transparente
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

// Convierte una matriz de letras en una textura (px = tamaño de cada "pixel")
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

// ===================== VEHÍCULOS =====================
// Todos están dibujados mirando hacia la derecha; si van a la izquierda se voltean.
function makeVehicleTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const done = (key, w, h) => { g.generateTexture(key, w, h); g.clear(); };
  const wheel = (x, y) => {
    g.fillStyle(0x111111); g.fillRect(x, y, 10, 8);
    g.fillStyle(0x888888); g.fillRect(x + 3, y + 2, 4, 4);
  };

  // Taxi amarillo (pequeño)
  g.fillStyle(0xf6c90e); g.fillRect(0, 12, 52, 20);
  g.fillRect(12, 4, 28, 10);
  g.fillStyle(0xd4a900); g.fillRect(0, 26, 52, 4);
  g.fillStyle(0x222222); g.fillRect(21, 0, 10, 4);               // letrero TAXI
  g.fillStyle(0xa8dcff); g.fillRect(14, 6, 10, 7); g.fillRect(28, 6, 10, 7);
  g.fillStyle(0xffffff); g.fillRect(48, 18, 4, 4);               // farol
  wheel(6, 30); wheel(36, 30);
  done('taxi', 52, 40);

  // Buses (azul y verde)
  const bus = (key, color, dark) => {
    g.fillStyle(color); g.fillRect(0, 4, 120, 30);
    g.fillStyle(dark);  g.fillRect(0, 26, 120, 8);
    g.fillStyle(0xffffff); g.fillRect(0, 22, 120, 2);            // franja
    g.fillStyle(0xa8dcff);
    for (let x = 8; x < 92; x += 18) g.fillRect(x, 9, 12, 10);   // ventanas
    g.fillRect(100, 9, 16, 14);                                  // parabrisas
    g.fillStyle(0xffe066); g.fillRect(116, 27, 4, 4);            // farol
    wheel(14, 30); wheel(88, 30);
    done(key, 120, 40);
  };
  bus('busBlue', 0x2f6fdb, 0x1f4fa3);
  bus('busGreen', 0x2fb35a, 0x1f8040);

  // Camión blanco
  g.fillStyle(0xffffff); g.fillRect(0, 4, 72, 30);               // caja
  g.fillStyle(0xcfd8dc); g.fillRect(0, 28, 72, 6);
  g.fillStyle(0xb0bec5); g.fillRect(0, 4, 72, 2);
  g.fillStyle(0xf5f5f5); g.fillRect(74, 12, 30, 22);             // cabina
  g.fillStyle(0xcfd8dc); g.fillRect(74, 28, 30, 6);
  g.fillStyle(0xa8dcff); g.fillRect(90, 15, 12, 9);
  g.fillStyle(0xffe066); g.fillRect(100, 27, 4, 4);
  wheel(8, 30); wheel(50, 30); wheel(82, 30);
  done('truck', 104, 40);

  g.destroy();
}

// ===================== DECORADO DE LA CIUDAD =====================
function makeScenery(scene) {
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const done = (key) => { g.generateTexture(key, TILE, TILE); g.clear(); };

  // Árbol
  g.fillStyle(0x5d4037); g.fillRect(16, 26, 8, 12);
  g.fillStyle(0x2e8b57); g.fillRect(6, 8, 28, 20);
  g.fillStyle(0x3cb371); g.fillRect(12, 2, 16, 8); g.fillRect(8, 10, 8, 6);
  done('tree');

  // Farola
  g.fillStyle(0x555555); g.fillRect(18, 10, 4, 28); g.fillRect(12, 6, 16, 6);
  g.fillStyle(0xfff3a0); g.fillRect(14, 12, 12, 3);
  done('lamp');

  g.destroy();
}

// ===================== PHASER =====================
function preload() {
  makePixelTexture(this, 'dog', DOG_PIXELS, PALETTE, 2);   // 16x16 px * 2 = 32x32
  makeVehicleTextures(this);
  makeScenery(this);
}

function create() {
  rows = [];
  bestRow = 0;
  hopping = false;
  gameOver = false;

  cars = this.physics.add.group({ allowGravity: false });

  for (let r = 0; r < 20; r++) addRow(this, r);

  dog = this.physics.add.image(colX(START_COL), rowY(0), 'dog').setDepth(3);
  dog.body.setSize(20, 20);    // hitbox más pequeña = más justo

  cursors = this.input.keyboard.createCursorKeys();

  scoreText = this.add.text(10, 10, 'Puntos: 0   Nivel: 1', {
    fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 4
  }).setScrollFactor(0).setDepth(10);

  this.physics.add.overlap(dog, cars, hitCar, null, this);
}

// Cada carril de calle tiene UN tipo de vehículo, con su propia velocidad
const LANE_TYPES = ['taxi', 'taxi', 'busBlue', 'busGreen', 'truck'];
const LANE_INFO = {
  taxi:     { n: 3, min: 140, max: 230 },   // pequeño y rápido
  busBlue:  { n: 2, min: 70,  max: 120 },
  busGreen: { n: 2, min: 70,  max: 120 },
  truck:    { n: 2, min: 60,  max: 110 }    // grande y lento
};

function addRow(scene, r) {
  const y = rowY(r);
  const isRoad = r > 1 && Math.random() < 0.55;    // las 2 primeras filas son seguras
  rows[r] = { type: isRoad ? 'road' : 'sidewalk', blocked: new Set() };

  const color = isRoad ? 0x3a3a3a : (r % 2 ? 0xa3a3a3 : 0x969696);
  scene.add.rectangle(WIDTH / 2, y, WIDTH, TILE, color).setDepth(0);

  if (isRoad) {
    // Línea discontinua entre dos carriles de calle seguidos
    if (rows[r - 1] && rows[r - 1].type === 'road') {
      for (let x = 0; x < WIDTH; x += 40) {
        scene.add.rectangle(x + 20, y + TILE / 2, 20, 3, 0xf2f2f2).setDepth(0.5);
      }
    }

    const type = Phaser.Utils.Array.GetRandom(LANE_TYPES);
    const info = LANE_INFO[type];
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = Phaser.Math.Between(info.min, info.max);
    const slot = WIDTH / info.n;

    for (let i = 0; i < info.n; i++) {
      const car = cars.create(0, y, type).setDepth(1);
      car.x = i * slot + car.width / 2 + Phaser.Math.Between(0, slot - car.width);
      car.setFlipX(dir < 0);
      car.setData({ dir: dir, speed: speed });                 // velocidad base del carril
      car.setVelocityX(dir * speed * speedMult());
      car.body.setSize(car.width - 8, 26);
    }
  } else if (r > 1) {
    // Aceras con árboles y farolas que bloquean el paso
    const count = Phaser.Math.Between(1, 3);
    for (let i = 0; i < count; i++) {
      const col = Phaser.Math.Between(0, COLS - 1);
      if (col === START_COL || rows[r].blocked.has(col)) continue;
      rows[r].blocked.add(col);
      scene.add.image(colX(col), y, Phaser.Math.RND.pick(['tree', 'lamp'])).setDepth(1);
    }
  }
}

function hop(scene, dx, dy) {
  const nx = dog.x + dx * TILE;
  const ny = dog.y + dy * TILE;
  if (nx < 0 || nx > WIDTH) return;                                  // límites laterales
  if (ny + TILE / 2 > scene.cameras.main.scrollY + HEIGHT) return;   // no salir por abajo

  const col = Math.round((nx - TILE / 2) / TILE);
  const row = Math.round((rowY(0) - ny) / TILE);
  if (rows[row] && rows[row].blocked.has(col)) return;               // árbol o farola

  hopping = true;
  scene.tweens.add({
    targets: dog, x: nx, y: ny, duration: 110, ease: 'Quad.easeOut',
    onComplete: () => { hopping = false; }
  });

  if (row > bestRow) {
    bestRow = row;
    scoreText.setText('Puntos: ' + bestRow + '   Nivel: ' + levelNow());
    if (bestRow % 10 === 0) showLevelUp(scene);
    while (rows.length < row + 20) addRow(scene, rows.length);       // mundo infinito
  }
}

function showLevelUp(scene) {
  const t = scene.add.text(WIDTH / 2, 120, '¡Nivel ' + levelNow() + '!', {
    fontSize: '30px', color: '#ffe066', stroke: '#000000', strokeThickness: 6
  }).setOrigin(0.5).setScrollFactor(0).setDepth(10);
  scene.tweens.add({
    targets: t, alpha: 0, y: 90, duration: 1200,
    onComplete: () => t.destroy()
  });
}

function hitCar() {
  if (gameOver) return;
  gameOver = true;
  this.physics.pause();
  dog.setTint(0xff6666).setScale(1.3, 0.4);    // perrito aplastado :(

  this.add.text(WIDTH / 2, HEIGHT / 2, 'GAME OVER\nPresiona ESPACIO', {
    fontSize: '32px', color: '#ffffff', align: 'center',
    stroke: '#000000', strokeThickness: 6
  }).setOrigin(0.5).setScrollFactor(0).setDepth(10);

  this.input.keyboard.once('keydown-SPACE', () => this.scene.restart());
}

function update() {
  if (gameOver) return;

  // Velocidad según el nivel y reaparición del otro lado de la pantalla
  const mult = speedMult();
  cars.getChildren().forEach(car => {
    const dir = car.getData('dir');
    car.setVelocityX(dir * car.getData('speed') * mult);   // se acelera con el nivel
    const margin = car.width / 2 + 10;
    if (dir > 0 && car.x > WIDTH + margin) car.x = -margin;
    else if (dir < 0 && car.x < -margin) car.x = WIDTH + margin;
  });

  // La cámara solo sube
  const cam = this.cameras.main;
  const target = dog.y - HEIGHT * 0.65;
  if (target < cam.scrollY) cam.scrollY = Phaser.Math.Linear(cam.scrollY, target, 0.1);

  // Un salto por pulsación
  if (!hopping) {
    if (Phaser.Input.Keyboard.JustDown(cursors.up))         hop(this, 0, -1);
    else if (Phaser.Input.Keyboard.JustDown(cursors.down))  hop(this, 0, 1);
    else if (Phaser.Input.Keyboard.JustDown(cursors.left))  hop(this, -1, 0);
    else if (Phaser.Input.Keyboard.JustDown(cursors.right)) hop(this, 1, 0);
  }
}