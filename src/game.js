// 게임 규칙과 시뮬레이션 (화면/네트워크 코드 없음)
// 멀티플레이에서는 방장(호스트)의 브라우저만 이 시뮬레이션을 돌리고,
// 참가자들은 입력만 보내고 결과(스냅샷)를 받아서 그립니다.

export const TILE = 32;
export const COLS = 30;
export const ROWS = 20;
export const WIDTH = TILE * COLS;
export const HEIGHT = TILE * ROWS;
export const MAX_PLAYERS = 4;

// 베이스캠프: 맵 중앙의 원형 구역. 이 안에만 건설할 수 있고, 쉬는 시간에 이 안에 있으면 체력이 찹니다.
export const CAMP = { x: 15 * TILE, y: 10 * TILE, r: 6 * TILE };

export const STRUCTS = {
  fence: { name: '울타리', cost: 5, hp: 10 },
  turret: { name: '터렛', cost: 30, hp: 6, range: 280, fireEvery: 0.45, bulletSpeed: 520 },
};
const MAX_STRUCTS = 40;

// Soul Knight식 강화 (웨이브 클리어마다 3개 중 1개 선택)
export const BUFFS = {
  dmg: { name: '공격력 강화', desc: '총알 피해 +1', max: 5 },
  rate: { name: '빠른 손', desc: '연사 속도 +25%', max: 5 },
  multi: { name: '멀티샷', desc: '총알 +1발', max: 3 },
  speed: { name: '날쌘 발', desc: '이동 속도 +12%', max: 4 },
  hp: { name: '튼튼한 몸', desc: '최대 체력 +2', max: 5 },
  pierce: { name: '관통탄', desc: '적을 1명 더 관통', max: 3 },
  bounce: { name: '도탄', desc: '벽에 1번 더 튕김', max: 3 },
  dash: { name: '그림자 대시', desc: '대시 쿨타임 -25%', max: 3 },
  vamp: { name: '흡혈', desc: '처치 시 12% 확률로 체력 +1', max: 3 },
};

// 무기 속성: 한 사람은 한 속성만. 같은 속성 카드를 고르면 레벨업, 다른 속성이면 교체.
// 서로 다른 속성을 가진 동료와 함께 맞히면 원소 반응이 일어납니다.
export const ELEMENTS = {
  fire: { name: '불', color: '#ff7043', desc: '화상(지속 피해)' },
  water: { name: '물', color: '#42a5f5', desc: '젖음(둔화), 전기·얼음과 반응' },
  electric: { name: '전기', color: '#fff176', desc: '주변 적에게 연쇄 번개' },
  ice: { name: '얼음', color: '#b2ebf2', desc: '둔화, 3번 맞히면 빙결' },
  wind: { name: '바람', color: '#dcedc8', desc: '넉백·상태이상 확산·탄속 증가' },
  poison: { name: '독', color: '#9ccc65', desc: '중독(중첩 지속 피해)' },
};
export const ELEMENT_MAX = 3;

// 강화 카드 키('dmg' 또는 'el:fire')의 표시용 정보
export function offerInfo(key, buffs = {}, element = null, elementLv = 0) {
  if (key.startsWith('el:')) {
    const k = key.slice(3), def = ELEMENTS[k];
    const lv = element === k ? elementLv + 1 : 1;
    const desc = element && element !== k ? `${def.desc} (현재 속성과 교체)` : def.desc;
    return { name: `${def.name} 속성`, desc, lv, max: ELEMENT_MAX, color: def.color };
  }
  const def = BUFFS[key];
  return { name: def.name, desc: def.desc, lv: (buffs[key] || 0) + 1, max: def.max, color: '#ffd54f' };
}

// 한 번 누르면 한 번 실행되는 행동들 (입력의 act 값)
export const ACTIONS = ['fence', 'turret', 'demolish', 'pick1', 'pick2', 'pick3', 'ready'];

const PLAYER_COLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];
const PLAYER_RADIUS = 12;
const PLAYER_MAX_HP = 6;
const PLAYER_SPEED = 190;
const DASH_SPEED = 560;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 0.9;
const FIRE_COOLDOWN = 0.16;
const BULLET_SPEED = 600;
const WAVE_BREAK = 12;
const FIRST_BREAK = 10;
const RESTART_DELAY = 3.5;
const START_GOLD = 20;
const CAMP_HEAL_EVERY = 1.5;

const ENEMY_TYPES = {
  slime: { r: 13, hp: 3, speed: 85, touch: 1, score: 10, gold: 3 },
  archer: { r: 12, hp: 2, speed: 95, fireEvery: 1.7, bulletSpeed: 260, score: 15, gold: 4 },
  brute: { r: 18, hp: 9, speed: 60, touch: 2, score: 30, gold: 10 },
};

const SPAWN_TILES = [[14, 9], [15, 9], [14, 10], [15, 10]];

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
  // 2x2 기둥 (가운데는 베이스캠프라 비워 둡니다)
  const blocks = [[5, 4], [23, 4], [5, 14], [23, 14]];
  for (const [bx, by] of blocks) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) map[by + dy][bx + dx] = 1;
  }
  return map;
}

function isWallTile(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  return MAP[ty][tx] === 1;
}

const tileCenter = (t) => t * TILE + TILE / 2;
const tileKey = (tx, ty) => ty * COLS + tx;

export function inCamp(tx, ty) {
  return Math.hypot(tileCenter(tx) - CAMP.x, tileCenter(ty) - CAMP.y) <= CAMP.r;
}

function structAt(state, tx, ty) {
  return state.structMap.get(tileKey(tx, ty)) || null;
}

function rebuildStructMap(state) {
  state.structMap = new Map(state.structs.map((s) => [tileKey(s.tx, s.ty), s]));
}

// 원이 벽(또는 적에게는 건물)과 겹치는지. 겹치면 'wall' 또는 그 건물을 돌려줍니다.
function circleBlocked(state, x, y, r, structsBlock) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wall = isWallTile(tx, ty);
      const st = !wall && structsBlock ? structAt(state, tx, ty) : null;
      if (!wall && !st) continue;
      const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
      const cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return wall ? 'wall' : st;
    }
  }
  return null;
}

// 축을 나눠서 움직이면 벽에 비스듬히 부딪혀도 미끄러지듯 이동합니다.
// 적은 건물에 막히며, 막은 건물을 돌려줍니다(공격 대상).
function moveCircle(state, e, dx, dy, structsBlock) {
  let hitStruct = null;
  const hx = circleBlocked(state, e.x + dx, e.y, e.r, structsBlock);
  if (!hx) e.x += dx; else if (hx !== 'wall') hitStruct = hx;
  const hy = circleBlocked(state, e.x, e.y + dy, e.r, structsBlock);
  if (!hy) e.y += dy; else if (hy !== 'wall') hitStruct = hy;
  return hitStruct;
}

export const EMPTY_INPUT = Object.freeze({
  up: false, down: false, left: false, right: false, fire: false, dash: false,
  aim: 0, act: null, seq: 0, bx: 0, by: 0, pz: false,
});

// 네트워크로 들어온 입력은 믿지 않고 정리해서 씁니다.
export function sanitizeInput(i) {
  if (!i || typeof i !== 'object') return EMPTY_INPUT;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right,
    fire: !!i.fire, dash: !!i.dash,
    aim: num(i.aim),
    act: ACTIONS.includes(i.act) ? i.act : null,
    seq: Math.trunc(num(i.seq)),
    bx: num(i.bx), by: num(i.by),
    pz: !!i.pz,
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
    structs: [],
    structMap: new Map(),
    fx: [],
    gold: START_GOLD,
    wave: 0,
    waveTimer: FIRST_BREAK,
    cleared: true,
    gameOverTimer: 0,
  };
}

// ---------- 플레이어 & 강화 ----------
function stats(p) {
  const b = p.buffs;
  return {
    dmg: 1 + (b.dmg || 0),
    fireCd: FIRE_COOLDOWN / (1 + 0.25 * (b.rate || 0)),
    shots: 1 + (b.multi || 0),
    speed: PLAYER_SPEED * (1 + 0.12 * (b.speed || 0)),
    pierce: b.pierce || 0,
    bounce: b.bounce || 0,
    dashCd: DASH_COOLDOWN * 0.75 ** (b.dash || 0),
    vamp: 0.12 * (b.vamp || 0),
  };
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function makeOffer(p) {
  const buffs = Object.keys(BUFFS).filter((k) => (p.buffs[k] || 0) < BUFFS[k].max);
  const elements = Object.keys(ELEMENTS)
    .filter((k) => !(p.element === k && p.elementLv >= ELEMENT_MAX))
    .map((k) => `el:${k}`);
  const offer = shuffle([...buffs, ...elements]).slice(0, 3);
  // 아직 속성이 없으면 속성 카드를 최소 1장 보여 줍니다.
  if (!p.element && elements.length && !offer.some((k) => k.startsWith('el:'))) {
    offer[offer.length - 1] = shuffle(elements)[0];
  }
  return offer.length ? offer : null;
}

function applyBuff(p, key) {
  if (key.startsWith('el:')) {
    const k = key.slice(3);
    if (p.element === k) p.elementLv = Math.min(ELEMENT_MAX, p.elementLv + 1);
    else { p.element = k; p.elementLv = 1; }
    return;
  }
  p.buffs[key] = (p.buffs[key] || 0) + 1;
  if (key === 'hp') {
    p.maxHp += 2;
    if (p.alive) p.hp += 2;
  }
}

function usedColor(state, color) {
  return Object.values(state.players).some((p) => p.color === color);
}

function placeAtSpawn(p, index) {
  const [tx, ty] = SPAWN_TILES[index % SPAWN_TILES.length];
  p.x = tileCenter(tx);
  p.y = tileCenter(ty);
}

export function addPlayer(state, id, name) {
  if (state.players[id]) return state.players[id];
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const color = PLAYER_COLORS.find((c) => !usedColor(state, c)) ?? PLAYER_COLORS[0];
  const p = {
    id, name: sanitizeName(name), color, x: 0, y: 0, r: PLAYER_RADIUS,
    angle: 0, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, score: 0,
    fireCd: 0, dashCd: 0, dashT: 0, dashX: 0, dashY: 0, invuln: 1,
    buffs: {}, offer: null, ready: false, lastSeq: 0, healT: 0,
    element: null, elementLv: 0, paused: false,
  };
  placeAtSpawn(p, Object.keys(state.players).length);
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
    p.ready = false;
  }
}

function nearest(list, x, y, maxDist = Infinity) {
  let best = null, bestD = maxDist * maxDist;
  for (const o of list) {
    const d = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

const isBreak = (state) => state.enemies.length === 0;

// ---------- 건설 ----------
export function canBuildAt(state, tx, ty) {
  if (isWallTile(tx, ty) || !inCamp(tx, ty) || structAt(state, tx, ty)) return false;
  if (state.structs.length >= MAX_STRUCTS) return false;
  // 적이 건물 안에 갇히지 않도록
  const x0 = tx * TILE, y0 = ty * TILE;
  return !state.enemies.some((e) => {
    const cx = Math.max(x0, Math.min(e.x, x0 + TILE));
    const cy = Math.max(y0, Math.min(e.y, y0 + TILE));
    return (e.x - cx) ** 2 + (e.y - cy) ** 2 < e.r * e.r;
  });
}

function build(state, p, kind, bx, by) {
  const tx = Math.floor(bx / TILE), ty = Math.floor(by / TILE);
  const def = STRUCTS[kind];
  if (state.gold < def.cost || !canBuildAt(state, tx, ty)) return;
  state.gold -= def.cost;
  state.structs.push({ id: state.nextId++, kind, tx, ty, hp: def.hp, maxHp: def.hp, cd: 0, owner: p.id });
  rebuildStructMap(state);
}

function demolish(state, bx, by) {
  const s = structAt(state, Math.floor(bx / TILE), Math.floor(by / TILE));
  if (!s) return;
  state.gold += Math.floor(STRUCTS[s.kind].cost / 2);
  state.structs = state.structs.filter((o) => o !== s);
  rebuildStructMap(state);
}

function damageStruct(state, s, dmg) {
  s.hp -= dmg;
  if (s.hp <= 0) {
    state.structs = state.structs.filter((o) => o !== s);
    rebuildStructMap(state);
  }
}

function doAction(state, p, inp) {
  const act = inp.act;
  if (act === 'pick1' || act === 'pick2' || act === 'pick3') {
    const key = p.offer?.[Number(act[4]) - 1];
    if (key) { applyBuff(p, key); p.offer = null; }
    return;
  }
  if (act === 'ready') { if (p.alive) p.ready = !p.ready; return; }
  if (!p.alive) return;
  if (act === 'fence' || act === 'turret') build(state, p, act, inp.bx, inp.by);
  else if (act === 'demolish') demolish(state, inp.bx, inp.by);
}

// ---------- 갱신 ----------
function fire(state, p, st) {
  p.fireCd = st.fireCd;
  const spread = 0.16;
  const speed = BULLET_SPEED * (p.element === 'wind' ? 1.3 : 1);
  for (let i = 0; i < st.shots; i++) {
    const a = p.angle + (i - (st.shots - 1) / 2) * spread + (Math.random() - 0.5) * 0.06;
    state.bullets.push({
      id: state.nextId++, owner: 'p', shooter: p.id,
      x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: 4, dmg: st.dmg, life: 1.1, pierce: st.pierce, bounce: st.bounce, hits: [],
      el: p.element, elv: p.elementLv,
    });
  }
}

function updatePlayer(state, p, inp, dt) {
  p.paused = inp.pz;
  if (inp.seq !== p.lastSeq) {
    p.lastSeq = inp.seq;
    if (inp.act) doAction(state, p, inp);
  }

  p.fireCd = Math.max(0, p.fireCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashT = Math.max(0, p.dashT - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  if (!p.alive) return;
  const st = stats(p);

  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }

  if (inp.dash && p.dashCd <= 0 && len > 0) {
    p.dashT = DASH_TIME;
    p.dashCd = st.dashCd;
    p.dashX = mx;
    p.dashY = my;
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.05);
  }

  // 플레이어는 자기 편 건물을 통과합니다 (적만 막힘).
  if (p.dashT > 0) moveCircle(state, p, p.dashX * DASH_SPEED * dt, p.dashY * DASH_SPEED * dt, false);
  else moveCircle(state, p, mx * st.speed * dt, my * st.speed * dt, false);

  p.angle = inp.aim;
  if (inp.fire && p.fireCd <= 0 && p.dashT <= 0) fire(state, p, st);

  // 쉬는 시간에 캠프 안에 있으면 체력 회복
  if (isBreak(state) && Math.hypot(p.x - CAMP.x, p.y - CAMP.y) <= CAMP.r && p.hp < p.maxHp) {
    p.healT += dt;
    if (p.healT >= CAMP_HEAL_EVERY) { p.healT = 0; p.hp++; }
  } else {
    p.healT = 0;
  }
}

// ---------- 속성 & 원소 반응 ----------
function addFx(state, fx) {
  if (state.fx.length < 80) state.fx.push(fx);
}

function reactText(state, e, text, color) {
  addFx(state, { k: 't', x: e.x, y: e.y - e.r - 6, text, c: color, t: 0.8, life: 0.8 });
}

function damageEnemy(state, e, dmg, src) {
  if (e.hp <= 0) return;
  e.hp -= dmg;
  e.hitT = 0.08;
  if (src) e.lastHit = src;
}

function enemiesNear(state, x, y, radius) {
  return state.enemies.filter((o) => o.hp > 0 && (o.x - x) ** 2 + (o.y - y) ** 2 <= radius * radius);
}

function newStatus() {
  return {
    burn: 0, burnTick: 0, burnBy: null, wet: 0, chill: 0, chillN: 0, frozen: 0,
    poison: 0, poisonN: 0, poisonTick: 0, poisonBy: null, stun: 0,
  };
}

function explode(state, e, lv, src) {
  reactText(state, e, '폭발!', '#ffab40');
  addFx(state, { k: 'r', x: e.x, y: e.y, r: 80, c: '#ffab40', t: 0.35, life: 0.35 });
  for (const o of enemiesNear(state, e.x, e.y, 80)) damageEnemy(state, o, 1 + lv, src);
}

function applyElement(state, e, b) {
  const s = e.st, lv = b.elv || 1, src = b.shooter;
  switch (b.el) {
    case 'fire':
      if (s.frozen > 0 || s.chill > 0) {
        reactText(state, e, '녹임!', '#ff8a65');
        Object.assign(s, { frozen: 0, chill: 0, chillN: 0 });
        damageEnemy(state, e, 2 + lv, src);
      } else if (s.poison > 0) {
        Object.assign(s, { poison: 0, poisonN: 0 });
        explode(state, e, lv, src);
      } else if (s.wet > 0) {
        reactText(state, e, '증발!', '#e0e0e0');
        s.wet = 0;
        damageEnemy(state, e, 1 + lv, src);
      } else {
        s.burn = Math.max(s.burn, 1.5 + lv * 0.5);
        s.burnBy = src;
      }
      break;

    case 'water':
      if (s.burn > 0) {
        reactText(state, e, '증발!', '#e0e0e0');
        s.burn = 0;
        damageEnemy(state, e, 1 + lv, src);
      }
      s.wet = Math.max(s.wet, 2.5 + lv);
      break;

    case 'electric':
      if (s.wet > 0) {
        // 감전: 근처의 젖은 적 모두에게 피해 + 기절
        reactText(state, e, '감전!', '#fff176');
        for (const o of enemiesNear(state, e.x, e.y, 130)) {
          if (o.st.wet <= 0) continue;
          damageEnemy(state, o, 1 + lv, src);
          o.st.stun = 0.6;
          o.st.wet = 0;
          if (o !== e) addFx(state, { k: 'l', x: e.x, y: e.y, x2: o.x, y2: o.y, c: '#fff176', t: 0.25, life: 0.25 });
        }
      } else {
        // 연쇄 번개: 레벨만큼 옆 적으로 튑니다.
        let from = e;
        const hit = new Set([e.id]);
        for (let i = 0; i < lv; i++) {
          const next = nearest(state.enemies.filter((o) => o.hp > 0 && !hit.has(o.id)), from.x, from.y, 150);
          if (!next) break;
          damageEnemy(state, next, 1, src);
          addFx(state, { k: 'l', x: from.x, y: from.y, x2: next.x, y2: next.y, c: '#fff176', t: 0.2, life: 0.2 });
          hit.add(next.id);
          from = next;
        }
      }
      break;

    case 'ice':
      if (s.burn > 0) {
        reactText(state, e, '녹임!', '#ff8a65');
        s.burn = 0;
        damageEnemy(state, e, 2 + lv, src);
      } else if (s.wet > 0) {
        reactText(state, e, '빙결!', '#b2ebf2');
        s.wet = 0;
        s.frozen = 1 + 0.5 * lv;
      } else {
        s.chill = 2;
        s.chillN++;
        if (s.chillN >= 3) {
          reactText(state, e, '빙결!', '#b2ebf2');
          Object.assign(s, { frozen: 0.8 + 0.3 * lv, chill: 0, chillN: 0 });
        }
      }
      break;

    case 'wind': {
      // 넉백 (벽을 뚫지 않도록 잘게 나눠 밀기)
      const len = Math.hypot(b.vx, b.vy) || 1;
      const push = 30 + 12 * lv;
      for (let d = 0; d < push; d += 10) {
        moveCircle(state, e, (b.vx / len) * Math.min(10, push - d), (b.vy / len) * Math.min(10, push - d), true);
      }
      // 확산: 이 적의 상태이상을 주변 적에게 옮깁니다.
      if (s.burn > 0 || s.poison > 0 || s.wet > 0 || s.chill > 0) {
        const others = enemiesNear(state, e.x, e.y, 90 + 20 * lv).filter((o) => o !== e);
        if (others.length) reactText(state, e, '확산!', '#dcedc8');
        for (const o of others) {
          const t = o.st;
          if (s.burn > 0) { t.burn = Math.max(t.burn, s.burn); t.burnBy = src; }
          if (s.poison > 0) { t.poison = Math.max(t.poison, s.poison); t.poisonN = Math.max(t.poisonN, s.poisonN); t.poisonBy = src; }
          t.wet = Math.max(t.wet, s.wet);
          t.chill = Math.max(t.chill, s.chill);
        }
      }
      break;
    }

    case 'poison':
      if (s.burn > 0) {
        s.burn = 0;
        explode(state, e, lv, src);
      } else {
        s.poison = 4;
        s.poisonN = Math.min(2 + lv, s.poisonN + 1);
        s.poisonBy = src;
      }
      break;

    default:
  }
}

// 상태이상 시간 감소와 지속 피해. 움직일 수 없으면 false를 돌려줍니다.
function updateStatus(state, e, dt) {
  const s = e.st;
  s.wet = Math.max(0, s.wet - dt);
  s.chill = Math.max(0, s.chill - dt);
  if (s.chill <= 0) s.chillN = 0;
  s.frozen = Math.max(0, s.frozen - dt);
  s.stun = Math.max(0, s.stun - dt);
  if (s.burn > 0) {
    s.burn -= dt;
    s.burnTick -= dt;
    if (s.burnTick <= 0) { s.burnTick = 0.5; damageEnemy(state, e, 1, s.burnBy); }
  }
  if (s.poison > 0) {
    s.poison -= dt;
    s.poisonTick -= dt;
    if (s.poisonTick <= 0) { s.poisonTick = 1; damageEnemy(state, e, s.poisonN, s.poisonBy); }
  } else {
    s.poisonN = 0;
  }
  return s.frozen <= 0 && s.stun <= 0;
}

function updateEnemy(state, e, alivePlayers, dt) {
  const T = ENEMY_TYPES[e.kind];
  e.hitT = Math.max(0, e.hitT - dt);
  if (!updateStatus(state, e, dt) || e.hp <= 0) return; // 빙결/기절 중엔 아무것도 못 함
  e.cd -= dt;
  const slow = (e.st.wet > 0 ? 0.8 : 1) * (e.st.chill > 0 ? 0.6 : 1);
  const target = nearest(alivePlayers, e.x, e.y);
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
        id: state.nextId++, owner: 'e', shooter: e.id, x: e.x, y: e.y,
        vx: Math.cos(a) * T.bulletSpeed, vy: Math.sin(a) * T.bulletSpeed,
        r: 5, dmg: 1, life: 2.5, pierce: 0, bounce: 0, hits: [],
      });
    }
  } else if (d < e.r + PLAYER_RADIUS + 2 && e.cd <= 0) {
    damagePlayer(target, T.touch);
    e.cd = 0.8;
  }

  const blocker = moveCircle(state, e, vx * T.speed * slow * dt, vy * T.speed * slow * dt, true);
  // 근접 적은 길을 막는 건물을 부숩니다.
  if (blocker && e.kind !== 'archer' && e.cd <= 0) {
    damageStruct(state, blocker, T.touch);
    e.cd = 0.8;
  }
}

// 적끼리 한 점에 겹치지 않도록 살짝 밀어냅니다.
function separateEnemies(state) {
  const list = state.enemies;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        moveCircle(state, a, (-dx / d) * push, (-dy / d) * push, true);
        moveCircle(state, b, (dx / d) * push, (dy / d) * push, true);
      }
    }
  }
}

function updateTurrets(state, dt) {
  const T = STRUCTS.turret;
  for (const s of state.structs) {
    if (s.kind !== 'turret') continue;
    s.cd -= dt;
    if (s.cd > 0) continue;
    const x = tileCenter(s.tx), y = tileCenter(s.ty);
    const target = nearest(state.enemies.filter((e) => e.hp > 0), x, y, T.range);
    if (!target) continue;
    s.cd = T.fireEvery;
    const a = Math.atan2(target.y - y, target.x - x);
    s.angle = a;
    state.bullets.push({
      id: state.nextId++, owner: 'p', shooter: s.owner, x, y,
      vx: Math.cos(a) * T.bulletSpeed, vy: Math.sin(a) * T.bulletSpeed,
      r: 4, dmg: 1, life: 0.8, pierce: 0, bounce: 0, hits: [], el: null, elv: 0,
    });
  }
}

function killEnemy(state, e, shooterId) {
  const T = ENEMY_TYPES[e.kind];
  state.gold += T.gold;
  const shooter = state.players[shooterId];
  if (!shooter) return;
  shooter.score += T.score;
  const st = stats(shooter);
  if (st.vamp > 0 && shooter.alive && Math.random() < st.vamp) {
    shooter.hp = Math.min(shooter.maxHp, shooter.hp + 1);
  }
}

function bulletHitsWall(b, dt) {
  const px = b.x - b.vx * dt, py = b.y - b.vy * dt;
  const wallAt = (x, y) => isWallTile(Math.floor(x / TILE), Math.floor(y / TILE));
  if (!wallAt(b.x, b.y)) return false;
  if (b.bounce <= 0) return true;
  b.bounce--;
  const hitX = wallAt(b.x, py), hitY = wallAt(px, b.y);
  if (hitX || !hitY) b.vx = -b.vx;
  if (hitY || !hitX) b.vy = -b.vy;
  b.x = px;
  b.y = py;
  return false;
}

function updateBullets(state, dt) {
  for (const b of state.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || bulletHitsWall(b, dt)) { b.dead = true; continue; }

    if (b.owner === 'p') {
      for (const e of state.enemies) {
        if (e.hp <= 0 || b.hits.includes(e.id)) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
          damageEnemy(state, e, b.dmg, b.shooter);
          if (b.el && e.hp > 0) applyElement(state, e, b);
          if (b.pierce > 0) { b.pierce--; b.hits.push(e.id); }
          else { b.dead = true; break; }
        }
      }
    } else {
      // 적 총알은 울타리/터렛에 막힙니다.
      const s = structAt(state, Math.floor(b.x / TILE), Math.floor(b.y / TILE));
      if (s) { damageStruct(state, s, b.dmg); b.dead = true; continue; }
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

// ---------- 웨이브 ----------
function findSpawn(state) {
  const alive = Object.values(state.players).filter((p) => p.alive);
  let x = tileCenter(2), y = tileCenter(2);
  for (let tries = 0; tries < 100; tries++) {
    const tx = 1 + Math.floor(Math.random() * (COLS - 2));
    const ty = 1 + Math.floor(Math.random() * (ROWS - 2));
    if (isWallTile(tx, ty) || Math.hypot(tileCenter(tx) - CAMP.x, tileCenter(ty) - CAMP.y) < CAMP.r + TILE * 2) continue;
    x = tileCenter(tx); y = tileCenter(ty);
    if (alive.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 220 ** 2)) break;
  }
  return { x, y };
}

function spawnWave(state) {
  const count = Math.min(3 + state.wave * 2, 26);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let kind = 'slime';
    if (state.wave >= 3 && r < 0.18) kind = 'brute';
    else if (state.wave >= 2 && r < 0.45) kind = 'archer';
    const T = ENEMY_TYPES[kind];
    const hp = T.hp + Math.floor(state.wave / 5); // 5웨이브마다 체력 +1
    const { x, y } = findSpawn(state);
    state.enemies.push({
      id: state.nextId++, kind, x, y, r: T.r, hp, maxHp: hp,
      cd: 1 + Math.random(), hitT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
      st: newStatus(), lastHit: null,
    });
  }
}

function resetRun(state) {
  Object.assign(state, {
    enemies: [], bullets: [], structs: [], structMap: new Map(), fx: [],
    gold: START_GOLD, wave: 0, waveTimer: FIRST_BREAK, cleared: true, gameOverTimer: 0,
  });
  Object.values(state.players).forEach((p, i) => {
    placeAtSpawn(p, i);
    Object.assign(p, {
      hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, score: 0, invuln: 1.5,
      dashT: 0, buffs: {}, offer: null, ready: false, element: null, elementLv: 0,
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
  if (!isBreak(state)) return;

  // 방금 웨이브를 깼다면: 보상 골드 + 강화 카드
  if (!state.cleared) {
    state.cleared = true;
    state.waveTimer = WAVE_BREAK;
    state.gold += 5 + state.wave * 2;
    for (const p of players) if (!p.offer) p.offer = makeOffer(p);
  }

  state.waveTimer -= dt;
  const alive = players.filter((p) => p.alive);
  const allReady = alive.every((p) => p.ready);
  if (state.waveTimer > 0 && !allReady) return;

  state.wave++;
  state.cleared = false;
  for (const p of players) {
    p.ready = false;
    if (!p.alive) Object.assign(p, { alive: true, hp: Math.ceil(p.maxHp / 2), invuln: 1.5 });
  }
  spawnWave(state);
}

export function step(state, inputs, dt) {
  state.time += dt;
  const players = Object.values(state.players);
  for (const p of players) updatePlayer(state, p, inputs[p.id] || EMPTY_INPUT, dt);
  const alive = players.filter((p) => p.alive);
  for (const e of state.enemies) updateEnemy(state, e, alive, dt);
  separateEnemies(state);
  updateTurrets(state, dt);
  updateBullets(state, dt);
  // 총알·지속 피해·반응 어떤 이유로든 쓰러진 적은 마지막으로 때린 사람에게 점수를 줍니다.
  for (const e of state.enemies) if (e.hp <= 0) killEnemy(state, e, e.lastHit);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  for (const f of state.fx) f.t -= dt;
  state.fx = state.fx.filter((f) => f.t > 0);
  updateWaves(state, players, dt);
}

const r1 = (n) => Math.round(n * 10) / 10;

// 상태이상을 글자로 압축: b화상 w젖음 c둔화 f빙결 p중독 z기절
function statusCode(s) {
  return (s.burn > 0 ? 'b' : '') + (s.wet > 0 ? 'w' : '') + (s.chill > 0 ? 'c' : '')
    + (s.frozen > 0 ? 'f' : '') + (s.poison > 0 ? 'p' : '') + (s.stun > 0 ? 'z' : '');
}

// 화면에 그릴 데이터만 추린 가벼운 사본 (네트워크 전송용)
export function snapshot(state) {
  return {
    w: state.wave,
    wt: r1(Math.max(0, state.waveTimer)),
    go: state.gameOverTimer > 0 ? 1 : 0,
    g: state.gold,
    p: Object.values(state.players).map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y),
      a: Math.round(p.angle * 100) / 100, hp: p.hp, mh: p.maxHp,
      al: p.alive ? 1 : 0, s: p.score, iv: p.invuln > 0 ? 1 : 0,
      bf: p.buffs, of: p.offer, rd: p.ready ? 1 : 0,
      el: p.element, elv: p.elementLv, pz: p.paused ? 1 : 0,
    })),
    e: state.enemies.map((e) => ({
      id: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), r: e.r,
      hp: e.hp, mh: e.maxHp, h: e.hitT > 0 ? 1 : 0, s: statusCode(e.st),
    })),
    fx: state.fx.map((f) => ({ ...f, x: r1(f.x), y: r1(f.y), t: r1(f.t) })),
    st: state.structs.map((s) => ({
      id: s.id, k: s.kind, tx: s.tx, ty: s.ty, hp: s.hp, mh: s.maxHp,
      a: s.angle !== undefined ? Math.round(s.angle * 100) / 100 : 0,
    })),
    b: state.bullets.map((b) => ({ x: r1(b.x), y: r1(b.y), r: b.r, o: b.owner === 'p' ? 0 : 1, el: b.el || 0 })),
  };
}
