/**
 * 2048 Game - Hello Kitty Edition
 * Responsive for mobile (touch/swipe) and laptop (keyboard)
 */

const GRID_SIZE = 4;
const CELL_COUNT = GRID_SIZE * GRID_SIZE;

// Image paths for tiles 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192+
const TILE_IMAGES = [
  'assets/1.png', 'assets/2.png', 'assets/3.png', 'assets/4.png', 'assets/5.png',
  'assets/6.png', 'assets/7.png', 'assets/8.png', 'assets/9.png', 'assets/10.png',
  'assets/11.png', 'assets/11.png', 'assets/11.png'
];

function getImageForValue(value) {
  const index = Math.min(Math.log2(value) - 1, 12);
  return TILE_IMAGES[Math.max(0, index)];
}

// DOM elements
const gridContainer = document.getElementById('grid-container');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const levelEl = document.getElementById('level');
const levelMaxEl = document.getElementById('level-max');
const kittyImgEl = document.getElementById('kitty-img');
const kittyMaxImgEl = document.getElementById('kitty-max-img');
const gameOverEl = document.getElementById('game-over');
const winOverlayEl = document.getElementById('win-overlay');
const retryBtn = document.getElementById('retry-btn');
const keepPlayingBtn = document.getElementById('keep-playing-btn');
const newGameBtn = document.getElementById('new-game-btn');

// Game state
let grid = [];
let score = 0;
let bestScore = parseInt(localStorage.getItem('2048-best') || '0');
let maxTileEver = parseInt(localStorage.getItem('2048-max-tile') || '0');
let gameOver = false;
let won = false;
let keepPlaying = false;
let moveCount = 0;

// Touch handling for swipe detection
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

const MIN_SWIPE_DISTANCE = 50;
const SPAWN_CHANCE = 0.65; // 65% chance to spawn (less often than every move)
const MOVE_ANIMATION_MS = 150; // match CSS transition duration

/* ========== CORE GAME LOGIC ========== */

/**
 * Initialize empty 4x4 grid
 */
function initGrid() {
  grid = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
}

/**
 * Get all empty cell positions
 */
function getEmptyCells() {
  const empty = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 0) empty.push({ r, c });
    }
  }
  return empty;
}

/**
 * Add a random tile (90% chance of 2, 10% chance of 4)
 */
function addRandomTile() {
  const empty = getEmptyCells();
  if (empty.length === 0) return null;

  const { r, c } = empty[Math.floor(Math.random() * empty.length)];
  const value = Math.random() < 0.9 ? 2 : 4;
  grid[r][c] = value;
  return { r, c, value };
}

/**
 * Rotate grid 90° clockwise (helps unify move logic)
 */
function rotateGrid() {
  const rotated = Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(0));
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      rotated[c][GRID_SIZE - 1 - r] = grid[r][c];
    }
  }
  grid = rotated;
}

/**
 * Flip grid horizontally
 */
function flipGrid() {
  for (let r = 0; r < GRID_SIZE; r++) {
    grid[r].reverse();
  }
}

/**
 * Merge a single row to the left (2048 core logic)
 * Returns { row, scoreGained, changed, sources } - sources[i] = fromCol for output at i
 */
function mergeRowLeft(row) {
  const filtered = row.map((cell, col) => ({ value: cell, col })).filter(x => x.value !== 0);
  const merged = [];
  const sources = [];
  let scoreGained = 0;

  for (let i = 0; i < filtered.length; i++) {
    if (i < filtered.length - 1 && filtered[i].value === filtered[i + 1].value) {
      const newVal = filtered[i].value * 2;
      merged.push(newVal);
      sources.push(filtered[i + 1].col); // animate from right tile
      scoreGained += newVal;
      i++;
    } else {
      merged.push(filtered[i].value);
      sources.push(filtered[i].col);
    }
  }

  while (merged.length < GRID_SIZE) merged.push(0);

  const changed = JSON.stringify(row) !== JSON.stringify(merged);
  return { row: merged, scoreGained, changed, sources };
}

/**
 * Move all rows left and merge
 * Returns { moved, scoreGained, moveMap } - moveMap: Map of "r,c" -> { fromR, fromC }
 */
function moveLeft() {
  let totalScore = 0;
  let anyChanged = false;
  const moveMap = new Map();

  for (let r = 0; r < GRID_SIZE; r++) {
    const { row, scoreGained, changed, sources } = mergeRowLeft(grid[r]);
    grid[r] = row;
    totalScore += scoreGained;
    anyChanged = anyChanged || changed;
    if (sources) {
      for (let c = 0; c < sources.length; c++) {
        if (row[c] !== 0) {
          moveMap.set(`${r},${c}`, { fromR: r, fromC: sources[c] });
        }
      }
    }
  }

  return { moved: anyChanged, scoreGained: totalScore, moveMap };
}

/** Transform moveMap from internal coords to original grid coords */
function transformMoveMap(moveMap, direction) {
  if (!moveMap || moveMap.size === 0) return moveMap;
  const transformed = new Map();
  const transform = (r, c) => {
    switch (direction) {
      case 'left': return { r, c };
      case 'right': return { r, c: GRID_SIZE - 1 - c };
      case 'up': return { r: c, c: GRID_SIZE - 1 - r };
      case 'down': return { r: GRID_SIZE - 1 - c, c: r };
      default: return { r, c };
    }
  };
  moveMap.forEach((val, key) => {
    const [toR, toC] = key.split(',').map(Number);
    const from = transform(val.fromR, val.fromC);
    const to = transform(toR, toC);
    transformed.set(`${to.r},${to.c}`, { fromR: from.r, fromC: from.c });
  });
  return transformed;
}

/**
 * Move in direction by rotating grid, merging left, then rotating back
 */
function move(direction) {
  if (gameOver) return false;

  let result;
  let moveMap = null;

  switch (direction) {
    case 'left':
      result = moveLeft();
      moveMap = result.moveMap;
      break;
    case 'right':
      flipGrid();
      result = moveLeft();
      moveMap = transformMoveMap(result.moveMap, 'right');
      flipGrid();
      break;
    case 'up':
      rotateGrid();
      rotateGrid();
      rotateGrid();
      result = moveLeft();
      moveMap = transformMoveMap(result.moveMap, 'up');
      rotateGrid();
      break;
    case 'down':
      rotateGrid();
      result = moveLeft();
      moveMap = transformMoveMap(result.moveMap, 'down');
      rotateGrid();
      rotateGrid();
      rotateGrid();
      break;
    default:
      return false;
  }

  if (result.moved) {
    score += result.scoreGained;
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem('2048-best', bestScore.toString());
    }
    updateScore();
    render(moveMap);

    setTimeout(() => {
      moveCount++;
      const shouldSpawn = moveCount <= 3 || Math.random() < SPAWN_CHANCE;
      if (shouldSpawn) {
        addRandomTile();
      }
      render();
      checkGameOver();
      if (!keepPlaying && !won) checkWin();
    }, MOVE_ANIMATION_MS);
  }

  return result.moved;
}

/**
 * Check if any moves are possible
 */
function canMove() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c < GRID_SIZE - 1 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < GRID_SIZE - 1 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

function checkGameOver() {
  if (getEmptyCells().length === 0 && !canMove()) {
    gameOver = true;
    gameOverEl.classList.add('visible');
  }
}

function checkWin() {
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 2048) {
        won = true;
        winOverlayEl.classList.add('visible');
        return;
      }
    }
  }
}

/* ========== RENDERING ========== */

function createGridCells() {
  gridContainer.innerHTML = '';
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell';
    gridContainer.appendChild(cell);
  }
}

function getTileClass(value) {
  if (value <= 2048) return `tile-${value}`;
  return 'tile-super';
}

function render(moveMap = null) {
  // Remove old tile elements
  gridContainer.querySelectorAll('.tile').forEach(t => t.remove());

  const cellSize = gridContainer.offsetWidth / GRID_SIZE;
  const gap = 6;
  const tileSize = cellSize - gap;

  const toPos = (r, c) => ({
    left: c * cellSize + gap / 2,
    top: r * cellSize + gap / 2
  });

  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const value = grid[r][c];
      if (value === 0) continue;

      const tile = document.createElement('div');
      tile.className = `tile ${getTileClass(value)}`;
      tile.dataset.row = r;
      tile.dataset.col = c;

      const img = document.createElement('img');
      img.src = getImageForValue(value);
      img.alt = value;
      img.className = 'tile-img';

      tile.appendChild(img);

      tile.style.width = `${tileSize}px`;
      tile.style.height = `${tileSize}px`;

      const dest = toPos(r, c);
      const move = moveMap && moveMap.get(`${r},${c}`);

      if (move && (move.fromR !== r || move.fromC !== c)) {
        const src = toPos(move.fromR, move.fromC);
        tile.style.left = `${src.left}px`;
        tile.style.top = `${src.top}px`;
        gridContainer.appendChild(tile);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            tile.style.left = `${dest.left}px`;
            tile.style.top = `${dest.top}px`;
          });
        });
      } else {
        tile.style.left = `${dest.left}px`;
        tile.style.top = `${dest.top}px`;
        gridContainer.appendChild(tile);
      }
    }
  }
}

function getHighestTile() {
  let max = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] > max) max = grid[r][c];
    }
  }
  return max;
}

function getLevelFromTile(value) {
  if (value <= 0) return null;
  return Math.log2(value);
}

function updateScore() {
  scoreEl.textContent = score;
  bestEl.textContent = bestScore;
  const highest = getHighestTile();
  if (highest > maxTileEver) {
    maxTileEver = highest;
    localStorage.setItem('2048-max-tile', maxTileEver.toString());
  }

  const level = getLevelFromTile(highest);
  const levelMax = getLevelFromTile(maxTileEver);
  levelEl.textContent = level != null ? level : '—';
  levelMaxEl.textContent = levelMax != null ? levelMax : '—';

  const kittyPlaceholder = document.getElementById('kitty-placeholder');
  const kittyMaxPlaceholder = document.getElementById('kitty-max-placeholder');
  if (highest > 0) {
    kittyImgEl.src = getImageForValue(highest);
    kittyImgEl.alt = highest;
    kittyImgEl.style.display = '';
    kittyPlaceholder.style.display = 'none';
  } else {
    kittyImgEl.style.display = 'none';
    kittyPlaceholder.style.display = 'inline';
  }
  if (maxTileEver > 0) {
    kittyMaxImgEl.src = getImageForValue(maxTileEver);
    kittyMaxImgEl.alt = maxTileEver;
    kittyMaxImgEl.style.display = '';
    kittyMaxPlaceholder.style.display = 'none';
  } else {
    kittyMaxImgEl.style.display = 'none';
    kittyMaxPlaceholder.style.display = 'inline';
  }
}

/* ========== INPUT HANDLING ========== */

function handleKeyDown(e) {
  const keyMap = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };
  const dir = keyMap[e.key];
  if (dir) {
    e.preventDefault();
    move(dir);
  }
}

function handleTouchStart(e) {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}

function handleTouchEnd(e) {
  touchEndX = e.changedTouches[0].screenX;
  touchEndY = e.changedTouches[0].screenY;
  handleSwipe();
}

function handleSwipe() {
  const dx = touchEndX - touchStartX;
  const dy = touchEndY - touchStartY;

  let direction = null;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dx) > MIN_SWIPE_DISTANCE) {
      direction = dx > 0 ? 'right' : 'left';
    }
  } else {
    if (Math.abs(dy) > MIN_SWIPE_DISTANCE) {
      direction = dy > 0 ? 'down' : 'up';
    }
  }

  if (direction) {
    move(direction);
  }
}

/* ========== GAME LIFECYCLE ========== */

function startGame() {
  initGrid();
  score = 0;
  moveCount = 0;
  gameOver = false;
  won = false;
  gameOverEl.classList.remove('visible');
  winOverlayEl.classList.remove('visible');

  addRandomTile();
  addRandomTile();
  updateScore();
  render();
}

function newGame() {
  keepPlaying = false;
  startGame();
}

/* ========== INIT ========== */

function init() {
  createGridCells();
  startGame();

  // Keyboard (laptop/desktop)
  document.addEventListener('keydown', handleKeyDown);

  // Touch (mobile)
  gridContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
  gridContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

  // Buttons
  newGameBtn.addEventListener('click', newGame);
  retryBtn.addEventListener('click', newGame);
  keepPlayingBtn.addEventListener('click', () => {
    keepPlaying = true;
    winOverlayEl.classList.remove('visible');
  });

  // Responsive: re-render on resize
  window.addEventListener('resize', () => {
    if (!gameOver) render();
  });
}

init();
