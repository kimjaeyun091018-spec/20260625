// 게임 규칙과 시뮬레이션 (화면/네트워크 코드 없음)
// 멀티플레이에서는 방장(호스트)의 브라우저만 이 시뮬레이션을 돌리고,
// 참가자들은 입력만 보내고 결과(스냅샷)를 받아서 그립니다.

export const TILE = 32;
export const COLS = 30;
export const ROWS = 20;
export const WIDTH = TILE * COLS;
export const HEIGHT = TILE * ROWS;
export const MAX_PLAYERS = 4;

const PLAYER_COLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];
const PLAYER_RADIUS = 12;
const PLAYER_MAX_HP = 6;
const PLAYER_SPEED = 190;
const DASH_SPEED = 560;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 0.9;
const FIRE_COOLDOWN = 0.16;
const BULLET_SPEED = 600;
const WAVE_BREAK = 3;
const RESTART_DELAY = 3.5;

const ENEMY_TYPES = {
  slime: { r: 13, hp: 3, speed: 85, touch: 1, score: 10 },
  archer: { r: 12, hp: 2, speed: 95, fireEvery: 1.7, bulletSpeed: 260, score: 15 },
  brute: { r: 18, hp: 9, speed: 60, touch: 2, score: 30 },
};

const SPAWN_TILES = [[12, 9], [17, 9], [12, 10], [17, 10]];

export const MAP = buildMap();

function buildMap() {
  const map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0);
    }
    map.push(row);
  }
  // 2x2 기둥
  const blocks = [[6, 4], [22, 4], [6, 14], [22, 14], [14, 9]];
  for (const [bx, by] of blocks) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) map[by + dy][bx + dx] = 1;
  }
  return map;
}

function isWallTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  return MAP[ty][tx] === 1;
}

function pointInWall(x, y) {
  return isWallTile(Math.floor(x / TILE), Math.floor(y / TILE));
}

function circleHitsWall(x, y, r) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!isWallTile(tx, ty)) continue;
      const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
      const cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
    }
  }
  return false;
}

// 축을 나눠서 움직이면 벽에 비스듬히 부딪혀도 미끄러지듯 이동합니다.
function moveCircle(e, dx, dy) {
  if (!circleHitsWall(e.x + dx, e.y, e.r)) e.x += dx;
  if (!circleHitsWall(e.x, e.y + dy, e.r)) e.y += dy;
}

const tileCenter = (t) => t * TILE + TILE / 2;

export const EMPTY_INPUT = Object.freeze({
  up: false, down: false, left: false, right: false, fire: false, dash: false, aim: 0,
});

// 네트워크로 들어온 입력은 믿지 않고 정리해서 씁니다.
export function sanitizeInput(i) {
  if (!i || typeof i !== 'object') return EMPTY_INPUT;
  const aim = Number(i.aim);
  return {
    up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right,
    fire: !!i.fire, dash: !!i.dash,
    aim: Number.isFinite(aim) ? aim : 0,
  };
}

export function sanitizeName(name) {
  const s = String(name ?? '').trim().slice(0, 10);
  return s || '기사';
}

export function createState() {
  return {
    time: 0,
    nextId: 1,
    players: {},
    enemies: [],
    bullets: [],
    wave: 0,
    waveTimer: 2,
    gameOverTimer: 0,
  };
}

function usedColor(state, color) {
  return Object.values(state.players).some((p) => p.color === color);
}

export function addPlayer(state, id, name) {
  if (state.players[id]) return state.players[id];
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const color = PLAYER_COLORS.find((c) => !usedColor(state, c)) ?? PLAYER_COLORS[0];
  const idx = Object.keys(state.players).length % SPAWN_TILES.length;
  const [tx, ty] = SPAWN_TILES[idx];
  const p = {
    id, name: sanitizeName(name), color,
    x: tileCenter(tx), y: tileCenter(ty), r: PLAYER_RADIUS,
    angle: 0, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, score: 0,
    fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashY: 0, invuln: 1,
  };
  state.players[id] = p;
  return p;
}

export function removePlayer(state, id) {
  delete state.players[id];
}

function damagePlayer(p, dmg) {
  if (!p.alive || p.invuln > 0) return;
  p.hp -= dmg;
  p.invuln = 0.7;
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
  }
}

function nearestAlivePlayer(players, x, y) {
  let best = null, bestD = Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function updatePlayer(state, p, inp, dt) {
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashT = Math.max(0, p.dashT - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (!p.alive) return;

  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }

  if (inp.dash && p.dashCd <= 0 && len > 0) {
    p.dashT = DASH_TIME;
    p.dashCd = DASH_COOLDOWN;
    p.dashX = mx;
    p.dashY = my;
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.05);
  }

  if (p.dashT > 0) moveCircle(p, p.dashX * DASH_SPEED * dt, p.dashY * DASH_SPEED * dt);
  else moveCircle(p, mx * PLAYER_SPEED * dt, my * PLAYER_SPEED * dt);

  p.angle = inp.aim;

  if (inp.fire && p.fireCd <= 0 && p.dashT <= 0) {
    p.fireCd = FIRE_COOLDOWN;
    const a = p.angle + (Math.random() - 0.5) * 0.08;
    state.bullets.push({
      id: state.nextId++, owner: 'p', shooter: p.id,
      x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
      vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED,
      r: 4, dmg: 1, life: 1.1,
    });
  }
}

function updateEnemy(state, e, players, dt) {
  const T = ENEMY_TYPES[e.kind];
  e.hitT = Math.max(0, e.hitT - dt);
  e.cd -= dt;
  const target = nearestAlivePlayer(players, e.x, e.y);
  if (!target) return;

  const dx = target.x - e.x, dy = target.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  let vx = ux, vy = uy;

  if (e.kind === 'archer') {
    if (Math.random() < dt * 0.5) e.strafe *= -1;
    if (d > 260) { vx = ux; vy = uy; }
    else if (d < 170) { vx = -ux; vy = -uy; }
    else { vx = -uy * e.strafe; vy = ux * e.strafe; }
    if (e.cd <= 0 && d < 420) {
      e.cd = T.fireEvery + Math.random() * 0.5;
      const a = Math.atan2(dy, dx);
      state.bullets.push({
        id: state.nextId++, owner: 'e', shooter: e.id,
        x: e.x, y: e.y,
        vx: Math.cos(a) * T.bulletSpeed, vy: Math.sin(a) * T.bulletSpeed,
        r: 5, dmg: 1, life: 2.5,
      });
    }
  } else if (d < e.r + PLAYER_RADIUS + 2 && e.cd <= 0) {
    damagePlayer(target, T.touch);
    e.cd = 0.8;
  }

  moveCircle(e, vx * T.speed * dt, vy * T.speed * dt);
}

// 적끼리 한 점에 겹치지 않도록 살짝 밀어냅니다.
function separateEnemies(enemies) {
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        moveCircle(a, (-dx / d) * push, (-dy / d) * push);
        moveCircle(b, (dx / d) * push, (dy / d) * push);
      }
    }
  }
}

function updateBullets(state, dt) {
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || pointInWall(b.x, b.y)) { b.dead = true; continue; }

    if (b.owner === 'p') {
      for (const e of state.enemies) {
        if (e.hp <= 0) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
          e.hp -= b.dmg;
          e.hitT = 0.08;
          b.dead = true;
          if (e.hp <= 0) {
            const shooter = state.players[b.shooter];
            if (shooter) shooter.score += ENEMY_TYPES[e.kind].score;
          }
          break;
        }
      }
    } else {
      for (const p of Object.values(state.players)) {
        // 대시 중(무적)이면 총알이 통과합니다.
        if (!p.alive || p.invuln > 0) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r) ** 2) {
          damagePlayer(p, b.dmg);
          b.dead = true;
          break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter((b) => !b.dead);
}

function findSpawn(state) {
  const alive = Object.values(state.players).filter((p) => p.alive);
  let x = 0, y = 0;
  for (let tries = 0; tries < 80; tries++) {
    const tx = 1 + Math.floor(Math.random() * (COLS - 2));
    const ty = 1 + Math.floor(Math.random() * (ROWS - 2));
    if (isWallTile(tx, ty)) continue;
    x = tileCenter(tx); y = tileCenter(ty);
    if (alive.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 220 ** 2)) return { x, y };
  }
  return { x: x || tileCenter(2), y: y || tileCenter(2) };
}

function spawnWave(state) {
  const count = Math.min(3 + state.wave * 2, 24);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let kind = 'slime';
    if (state.wave >= 3 && r < 0.15) kind = 'brute';
    else if (state.wave >= 2 && r < 0.45) kind = 'archer';
    const T = ENEMY_TYPES[kind];
    const { x, y } = findSpawn(state);
    state.enemies.push({
      id: state.nextId++, kind, x, y, r: T.r,
      hp: T.hp, maxHp: T.hp, cd: 1 + Math.random(), hitT: 0,
      strafe: Math.random() < 0.5 ? 1 : -1,
    });
  }
}

function resetRun(state) {
  state.enemies = [];
  state.bullets = [];
  state.wave = 0;
  state.waveTimer = 2;
  state.gameOverTimer = 0;
  Object.values(state.players).forEach((p, i) => {
    const [tx, ty] = SPAWN_TILES[i % SPAWN_TILES.length];
    Object.assign(p, {
      x: tileCenter(tx), y: tileCenter(ty), hp: p.maxHp, alive: true,
      score: 0, invuln: 1.5, dashT: 0,
    });
  });
}

function updateWaves(state, players, dt) {
  if (players.length === 0) return;
  if (!players.some((p) => p.alive)) {
    state.gameOverTimer += dt;
    if (state.gameOverTimer >= RESTART_DELAY) resetRun(state);
    return;
  }
  if (state.enemies.length > 0) return;

  state.waveTimer -= dt;
  if (state.waveTimer > 0) return;

  state.wave++;
  for (const p of players) {
    if (p.alive) p.hp = Math.min(p.maxHp, p.hp + 1);
    else Object.assign(p, { alive: true, hp: Math.ceil(p.maxHp / 2), invuln: 1.5 });
  }
  spawnWave(state);
  state.waveTimer = WAVE_BREAK;
}

export function step(state, inputs, dt) {
  state.time += dt;
  const players = Object.values(state.players);
  for (const p of players) updatePlayer(state, p, inputs[p.id] || EMPTY_INPUT, dt);
  for (const e of state.enemies) updateEnemy(state, e, players, dt);
  separateEnemies(state.enemies);
  updateBullets(state, dt);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  updateWaves(state, players, dt);
}

const r1 = (n) => Math.round(n * 10) / 10;

// 화면에 그릴 데이터만 추린 가벼운 사본 (네트워크 전송용)
export function snapshot(state) {
  return {
    w: state.wave,
    wt: r1(Math.max(0, state.waveTimer)),
    go: state.gameOverTimer > 0 ? 1 : 0,
    p: Object.values(state.players).map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y),
      a: Math.round(p.angle * 100) / 100, hp: p.hp, mh: p.maxHp,
      al: p.alive ? 1 : 0, s: p.score, iv: p.invuln > 0 ? 1 : 0,
    })),
    e: state.enemies.map((e) => ({
      id: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), r: e.r,
      hp: e.hp, mh: e.maxHp, h: e.hitT > 0 ? 1 : 0,
    })),
    b: state.bullets.map((b) => ({ x: r1(b.x), y: r1(b.y), r: b.r, o: b.owner === 'p' ? 0 : 1 })),
  };
}
