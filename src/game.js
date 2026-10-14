// 게임 규칙과 시뮬레이션 (화면/네트워크 코드 없음)
// 멀티플레이에서는 방장(호스트)의 브라우저만 이 시뮬레이션을 돌리고,
// 참가자들은 입력만 보내고 결과(스냅샷)를 받아서 그립니다.
//
// 흐름: lobby(무기·모드 선택) → playing → (모험) transition(스테이지 보상) → playing … → over → lobby

import {
  TILE, MAX_PLAYERS, WEAPONS, WEAPON_KEYS, sameWeaponLimit, ENEMY_TYPES, STRUCTS, BUFFS,
  ELEMENTS, ELEMENT_MAX, ELEMENT_MAX_BONUS, STAGE_REWARDS, STAGES_PER_WORLD, WORLDS,
  stageLabel, xpToNext,
} from './data.js';
import { buildCampMap, generateDungeon, tileCenter } from './maps.js';

const PLAYER_COLORS = ['#4fc3f7', '#ffb74d', '#f06292', '#aed581'];
const PLAYER_RADIUS = 12;
const PLAYER_MAX_HP = 6;
const PLAYER_SPEED = 190;
const DASH_SPEED = 560;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 0.9;
const WAVE_BREAK = 12;
const FIRST_BREAK = 10;
const OVER_DELAY = 4;
const START_GOLD = 20;
const CAMP_HEAL_EVERY = 1.5;
const MAX_STRUCTS = 40;
const MAX_ORBS = 160;
const ORB_LIFE = 45;
const TRANSITION_TIME = 30;

const ACTION_RE = /^(fence|turret|demolish|ready|start|pick[1-3]|reward[1-3]|mode:(camp|adv)|weapon:[a-z]+)$/;

// ---------- 입력 ----------
export const EMPTY_INPUT = Object.freeze({
  up: false, down: false, left: false, right: false, fire: false, dash: false,
  aim: 0, act: null, seq: 0, bx: 0, by: 0, pz: false,
});

// 네트워크로 들어온 입력은 믿지 않고 정리해서 씁니다.
export function sanitizeInput(i) {
  if (!i || typeof i !== 'object') return EMPTY_INPUT;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const act = typeof i.act === 'string' && ACTION_RE.test(i.act) ? i.act : null;
  return {
    up: !!i.up, down: !!i.down, left: !!i.left, right: !!i.right,
    fire: !!i.fire, dash: !!i.dash, aim: num(i.aim),
    act, seq: Math.trunc(num(i.seq)), bx: num(i.bx), by: num(i.by), pz: !!i.pz,
  };
}

export function sanitizeName(name) {
  const s = String(name ?? '').trim().slice(0, 10);
  return s || '기사';
}

// ---------- 상태 ----------
export function createState(hostId) {
  return {
    hostId,
    phase: 'lobby',
    mode: 'adv',
    time: 0,
    nextId: 1,
    players: {},
    enemies: [],
    bullets: [],
    structs: [],
    structMap: new Map(),
    fx: [],
    orbs: [],
    map: buildCampMap(),
    doorSet: new Set(),
    activeRoom: null,
    stageIdx: 0,
    portalT: 0,
    transT: 0,
    overT: 0,
    overText: '',
    gold: START_GOLD,
    wave: 0,
    waveTimer: FIRST_BREAK,
    cleared: true,
  };
}

// ---------- 맵/충돌 ----------
const tileKey = (state, tx, ty) => ty * state.map.cols + tx;

function isWallTile(state, tx, ty) {
  const m = state.map;
  if (tx < 0 || ty < 0 || tx >= m.cols || ty >= m.rows) return true;
  return m.tiles[ty * m.cols + tx] === 1 || state.doorSet.has(tileKey(state, tx, ty));
}

const wallAtPoint = (state, x, y) => isWallTile(state, Math.floor(x / TILE), Math.floor(y / TILE));

export function inCamp(map, tx, ty) {
  if (!map.camp) return false;
  return Math.hypot(tileCenter(tx) - map.camp.x, tileCenter(ty) - map.camp.y) <= map.camp.r;
}

function structAt(state, tx, ty) {
  return state.structMap.get(tileKey(state, tx, ty)) || null;
}

function rebuildStructMap(state) {
  state.structMap = new Map(state.structs.map((s) => [tileKey(state, s.tx, s.ty), s]));
}

// 원이 벽(또는 적에게는 건물)과 겹치는지. 겹치면 'wall' 또는 그 건물을 돌려줍니다.
function circleBlocked(state, x, y, r, structsBlock) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wall = isWallTile(state, tx, ty);
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
function moveCircle(state, e, dx, dy, structsBlock) {
  let hitStruct = null;
  const hx = circleBlocked(state, e.x + dx, e.y, e.r, structsBlock);
  if (!hx) e.x += dx; else if (hx !== 'wall') hitStruct = hx;
  const hy = circleBlocked(state, e.x, e.y + dy, e.r, structsBlock);
  if (!hy) e.y += dy; else if (hy !== 'wall') hitStruct = hy;
  return hitStruct;
}

// 벽을 뚫지 않게 잘게 나눠 밀기 (넉백)
function push(state, e, ux, uy, dist) {
  for (let d = 0; d < dist; d += 8) moveCircle(state, e, ux * Math.min(8, dist - d), uy * Math.min(8, dist - d), true);
}

function nearest(list, x, y, maxDist = Infinity) {
  let best = null, bestD = maxDist * maxDist;
  for (const o of list) {
    const d = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function addFx(state, fx) {
  if (state.fx.length < 100) state.fx.push(fx);
}

function floatText(state, x, y, text, c, life = 0.8) {
  addFx(state, { k: 't', x, y, text, c, t: life, life });
}

// ---------- 플레이어 ----------
function usedColor(state, color) {
  return Object.values(state.players).some((p) => p.color === color);
}

function freshRunStats(p) {
  Object.assign(p, {
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, score: 0, invuln: 1.5,
    fireCd: 0, dashCd: 0, dashT: 0, healT: 0,
    buffs: {}, offer: null, offerQueue: 0, element: null, elementLv: 0,
    level: 1, xp: 0, ready: false, reward: null, rewardDone: false,
    bonus: { dmg: 0, rate: 0, speed: 0, xpMul: 1, iron: false },
  });
}

export function addPlayer(state, id, name) {
  if (state.players[id]) return state.players[id];
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const color = PLAYER_COLORS.find((c) => !usedColor(state, c)) ?? PLAYER_COLORS[0];
  const p = {
    id, name: sanitizeName(name), color, x: 0, y: 0, r: PLAYER_RADIUS,
    angle: 0, weapon: null, lastSeq: 0, paused: false, dashX: 0, dashY: 0,
  };
  freshRunStats(p);
  // 게임 도중 들어오면 관전(쓰러진 상태)으로 시작해서 다음 부활 때 합류합니다.
  if (state.phase !== 'lobby') {
    p.weapon = pickFreeWeapon(state);
    p.alive = false;
    p.hp = 0;
  }
  placeAtSpawn(state, p, Object.keys(state.players).length);
  state.players[id] = p;
  return p;
}

export function removePlayer(state, id) {
  delete state.players[id];
}

function placeAtSpawn(state, p, index) {
  const s = state.map.spawn;
  const offs = [[-20, -16], [20, -16], [-20, 16], [20, 16]][index % 4];
  p.x = s.x + offs[0];
  p.y = s.y + offs[1];
}

function weaponCount(state, key, exceptId) {
  return Object.values(state.players).filter((p) => p.weapon === key && p.id !== exceptId).length;
}

function pickFreeWeapon(state) {
  const limit = sameWeaponLimit(Object.keys(state.players).length + 1);
  return WEAPON_KEYS.find((k) => weaponCount(state, k) < limit) || 'gun';
}

function stats(p) {
  const b = p.buffs, B = p.bonus;
  const W = WEAPONS[p.weapon] || WEAPONS.gun;
  return {
    W,
    dmg: W.dmg + (b.dmg || 0) + B.dmg,
    cd: W.cd / (1 + 0.25 * (b.rate || 0) + B.rate),
    shots: 1 + (b.multi || 0),
    speed: PLAYER_SPEED * (1 + 0.12 * (b.speed || 0) + B.speed),
    pierce: (W.pierce || 0) + (b.pierce || 0),
    bounce: b.bounce || 0,
    reach: 1 + 0.2 * (b.reach || 0),
    dashCd: DASH_COOLDOWN * 0.75 ** (b.dash || 0) * (B.iron ? 0.7 : 1),
    vamp: 0.12 * (b.vamp || 0),
  };
}

function damagePlayer(p, dmg) {
  if (!p.alive || p.invuln > 0) return;
  p.hp -= dmg;
  p.invuln = 0.7 * (p.bonus.iron ? 2 : 1);
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.ready = false;
  }
}

function revive(state, p, hpRatio, near) {
  p.alive = true;
  p.hp = Math.max(1, Math.ceil(p.maxHp * hpRatio));
  p.invuln = 1.5;
  if (near) { p.x = near.x; p.y = near.y; }
}

// ---------- 증강 (레벨업) ----------
function makeOffer(p) {
  const kind = (WEAPONS[p.weapon] || WEAPONS.gun).kind;
  const ranged = kind === 'ranged';
  const buffs = Object.keys(BUFFS).filter((k) => {
    const d = BUFFS[k];
    if (d.ranged && !ranged) return false;
    if (d.melee && ranged) return false;
    return (p.buffs[k] || 0) < d.max;
  });
  const elements = Object.keys(ELEMENTS)
    .filter((k) => !(p.element === k && p.elementLv >= ELEMENT_MAX))
    .map((k) => `el:${k}`);
  const offer = shuffle([...buffs, ...elements]).slice(0, 3);
  if (!p.element && elements.length && !offer.some((k) => k.startsWith('el:'))) {
    offer[offer.length - 1] = shuffle(elements)[0];
  }
  return offer.length ? offer : null;
}

function applyBuff(p, key) {
  if (key.startsWith('el:')) {
    const k = key.slice(3);
    if (p.element === k) p.elementLv = Math.min(ELEMENT_MAX_BONUS, p.elementLv + 1);
    else { p.element = k; p.elementLv = 1; }
    return;
  }
  p.buffs[key] = (p.buffs[key] || 0) + 1;
  if (key === 'hp') {
    p.maxHp += 2;
    if (p.alive) p.hp += 2;
  }
}

function nextOffer(p) {
  if (!p.offer && p.offerQueue > 0) {
    p.offerQueue--;
    p.offer = makeOffer(p);
  }
}

function gainXp(p, amount) {
  p.xp += amount * p.bonus.xpMul;
  let need = xpToNext(p.level);
  while (p.xp >= need) {
    p.xp -= need;
    p.level++;
    p.offerQueue++;
    need = xpToNext(p.level);
  }
  nextOffer(p);
}

// ---------- 스테이지 보상 ----------
function makeReward(p) {
  const keys = Object.keys(STAGE_REWARDS).filter((k) => {
    if (k === 'iron') return !p.bonus.iron;
    if (k === 'awaken') return !(p.element && p.elementLv >= ELEMENT_MAX_BONUS);
    return true;
  });
  return shuffle(keys).slice(0, 3).map((k) => `rw:${k}`);
}

function applyReward(p, key) {
  const k = key.slice(3);
  const B = p.bonus;
  if (k === 'awaken') {
    if (p.element) p.elementLv = Math.min(ELEMENT_MAX_BONUS, p.elementLv + 1);
    else { p.element = shuffle(Object.keys(ELEMENTS))[0]; p.elementLv = 2; }
  } else if (k === 'heart') {
    p.maxHp += 3;
    p.hp = p.maxHp;
  } else if (k === 'might') B.dmg += 2;
  else if (k === 'gale') { B.rate += 0.4; B.speed += 0.1; }
  else if (k === 'wisdom') B.xpMul += 0.5;
  else if (k === 'iron') B.iron = true;
}

// ---------- 로비 ----------
export function lobbyProblem(state) {
  const players = Object.values(state.players);
  if (players.some((p) => !p.weapon)) return '모든 플레이어가 무기를 골라야 해요.';
  const limit = sameWeaponLimit(players.length);
  for (const k of WEAPON_KEYS) {
    if (players.filter((p) => p.weapon === k).length > limit) {
      return players.length <= 2
        ? `2인 플레이에서는 같은 무기(${WEAPONS[k].name})를 고를 수 없어요.`
        : `같은 무기(${WEAPONS[k].name})는 최대 2명까지 고를 수 있어요.`;
    }
  }
  return null;
}

function lobbyAction(state, p, act) {
  if (act.startsWith('weapon:')) {
    const k = act.slice(7);
    if (!WEAPONS[k]) return;
    const limit = sameWeaponLimit(Object.keys(state.players).length);
    if (weaponCount(state, k, p.id) < limit) p.weapon = k;
  } else if (act.startsWith('mode:') && p.id === state.hostId) {
    state.mode = act.slice(5);
  } else if (act === 'start' && p.id === state.hostId && !lobbyProblem(state)) {
    startRun(state);
  }
}

function clearEntities(state) {
  Object.assign(state, {
    enemies: [], bullets: [], structs: [], structMap: new Map(), fx: [], orbs: [],
    doorSet: new Set(), activeRoom: null, portalT: 0,
  });
}

function startRun(state) {
  clearEntities(state);
  Object.values(state.players).forEach(freshRunStats);
  state.phase = 'playing';
  state.overText = '';
  if (state.mode === 'camp') {
    Object.assign(state, { gold: START_GOLD, wave: 0, waveTimer: FIRST_BREAK, cleared: true });
    state.map = buildCampMap();
  } else {
    state.stageIdx = 0;
    state.map = generateDungeon(0);
  }
  Object.values(state.players).forEach((p, i) => placeAtSpawn(state, p, i));
}

function endRun(state, text) {
  state.phase = 'over';
  state.overText = text;
  state.overT = OVER_DELAY;
}

function backToLobby(state) {
  clearEntities(state);
  state.phase = 'lobby';
  state.map = buildCampMap();
  Object.values(state.players).forEach((p, i) => { freshRunStats(p); placeAtSpawn(state, p, i); });
}

// ---------- 행동 처리 ----------
export function canBuildAt(state, tx, ty) {
  if (state.mode !== 'camp' || isWallTile(state, tx, ty) || !inCamp(state.map, tx, ty) || structAt(state, tx, ty)) return false;
  if (state.structs.length >= MAX_STRUCTS) return false;
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
  if (state.phase === 'lobby') { lobbyAction(state, p, act); return; }
  if (state.phase === 'transition') {
    if (act.startsWith('reward') && p.reward && !p.rewardDone) {
      const key = p.reward[Number(act[6]) - 1];
      if (key) { applyReward(p, key); p.rewardDone = true; }
    }
    return;
  }
  if (state.phase !== 'playing') return;
  if (act.startsWith('pick')) {
    const key = p.offer?.[Number(act[4]) - 1];
    if (key) { applyBuff(p, key); p.offer = null; nextOffer(p); }
    return;
  }
  if (act === 'ready') { if (p.alive && state.mode === 'camp') p.ready = !p.ready; return; }
  if (!p.alive || state.mode !== 'camp') return;
  if (act === 'fence' || act === 'turret') build(state, p, act, inp.bx, inp.by);
  else if (act === 'demolish') demolish(state, inp.bx, inp.by);
}

// ---------- 공격 ----------
function shoot(state, p, st) {
  const W = st.W;
  const spread = 0.16;
  const speed = W.speed * (p.element === 'wind' ? 1.3 : 1);
  for (let i = 0; i < st.shots; i++) {
    const a = p.angle + (i - (st.shots - 1) / 2) * spread + (Math.random() - 0.5) * 0.06;
    state.bullets.push({
      id: state.nextId++, owner: 'p', shooter: p.id, kind: p.weapon,
      x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: p.weapon === 'bow' ? 5 : 4, dmg: st.dmg, life: W.life, pierce: st.pierce, bounce: st.bounce, hits: [],
      el: p.element, elv: p.elementLv,
    });
  }
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

function melee(state, p, st) {
  const W = st.W;
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  const color = ELEMENTS[p.element]?.color || '#ffffff';
  let targets;
  if (W.kind === 'slam') {
    const cx = p.x + ax * W.reach * st.reach, cy = p.y + ay * W.reach * st.reach;
    const rad = W.radius * st.reach;
    targets = state.enemies.filter((e) => e.hp > 0 && (e.x - cx) ** 2 + (e.y - cy) ** 2 <= (rad + e.r) ** 2);
    addFx(state, { k: 'r', x: cx, y: cy, r: rad, c: color, t: 0.25, life: 0.25 });
  } else {
    const range = W.range * st.reach;
    targets = state.enemies.filter((e) => {
      if (e.hp <= 0) return false;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      return d <= range + e.r && angleDiff(Math.atan2(e.y - p.y, e.x - p.x), p.angle) <= W.arc / 2 + e.r / Math.max(d, 1);
    });
    addFx(state, { k: 'a', x: p.x, y: p.y, a: p.angle, r: range, s: W.arc, c: color, t: 0.14, life: 0.14 });
    // 검: 적 총알을 베어 없앰
    if (p.weapon === 'sword') {
      for (const b of state.bullets) {
        if (b.owner !== 'e') continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d <= range + 6 && angleDiff(Math.atan2(b.y - p.y, b.x - p.x), p.angle) <= W.arc / 2) b.dead = true;
      }
    }
  }
  const hit = { el: p.element, elv: p.elementLv, shooter: p.id, vx: ax, vy: ay };
  for (const e of targets) {
    damageEnemy(state, e, st.dmg, p.id);
    if (e.hp > 0) {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      push(state, e, (e.x - p.x) / d, (e.y - p.y) / d, W.knock);
      if (p.element) applyElement(state, e, hit);
    }
  }
}

function updatePlayer(state, p, inp, dt) {
  p.paused = inp.pz;
  if (inp.seq !== p.lastSeq) {
    p.lastSeq = inp.seq;
    if (inp.act) doAction(state, p, inp);
  }
  if (state.phase !== 'playing') return;

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
  if (p.dashT > 0) moveCircle(state, p, p.dashX * DASH_SPEED * dt, p.dashY * DASH_SPEED * dt, false);
  else moveCircle(state, p, mx * st.speed * dt, my * st.speed * dt, false);

  p.angle = inp.aim;
  if (inp.fire && p.fireCd <= 0 && p.dashT <= 0) {
    p.fireCd = st.cd;
    if (st.W.kind === 'ranged') shoot(state, p, st);
    else melee(state, p, st);
  }

  // 경험치 구슬: 플레이어마다 따로 줍습니다 (1P가 먹어도 2P 몫은 남아 있음)
  for (const o of state.orbs) {
    if (o.taken.includes(p.id)) continue;
    if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < 36 * 36) {
      o.taken.push(p.id);
      gainXp(p, o.v);
    }
  }

  // 베이스캠프: 쉬는 시간에 캠프 안에 있으면 체력 회복
  const camp = state.map.camp;
  if (camp && state.enemies.length === 0 && Math.hypot(p.x - camp.x, p.y - camp.y) <= camp.r && p.hp < p.maxHp) {
    p.healT += dt;
    if (p.healT >= CAMP_HEAL_EVERY) { p.healT = 0; p.hp++; }
  } else {
    p.healT = 0;
  }
}

// ---------- 속성 & 원소 반응 ----------
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

const reactText = (state, e, text, color) => floatText(state, e.x, e.y - e.r - 6, text, color);

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
        reactText(state, e, '감전!', '#fff176');
        for (const o of enemiesNear(state, e.x, e.y, 130)) {
          if (o.st.wet <= 0) continue;
          damageEnemy(state, o, 1 + lv, src);
          o.st.stun = 0.6;
          o.st.wet = 0;
          if (o !== e) addFx(state, { k: 'l', x: e.x, y: e.y, x2: o.x, y2: o.y, c: '#fff176', t: 0.25, life: 0.25 });
        }
      } else {
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
      const len = Math.hypot(b.vx, b.vy) || 1;
      push(state, e, b.vx / len, b.vy / len, 30 + 12 * lv);
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

// ---------- 적 ----------
function makeEnemy(state, kind, x, y, hpBonus) {
  const T = ENEMY_TYPES[kind];
  const hp = T.hp + hpBonus;
  return {
    id: state.nextId++, kind, x, y, r: T.r, hp, maxHp: hp,
    cd: 1 + Math.random(), hitT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
    st: newStatus(), lastHit: null,
  };
}

function pickKind(level) {
  const r = Math.random();
  if (level >= 3 && r < 0.18) return 'brute';
  if (level >= 2 && r < 0.45) return 'archer';
  return 'slime';
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
  if (blocker && e.kind !== 'archer' && e.cd <= 0) {
    damageStruct(state, blocker, T.touch);
    e.cd = 0.8;
  }
}

function separateEnemies(state) {
  const list = state.enemies;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (d > 0 && d < min) {
        const pushD = (min - d) / 2;
        moveCircle(state, a, (-dx / d) * pushD, (-dy / d) * pushD, true);
        moveCircle(state, b, (dx / d) * pushD, (dy / d) * pushD, true);
      }
    }
  }
}

function updateTurrets(state, dt) {
  const T = STRUCTS.turret;
  const alive = state.enemies.filter((e) => e.hp > 0);
  for (const s of state.structs) {
    if (s.kind !== 'turret') continue;
    s.cd -= dt;
    if (s.cd > 0) continue;
    const x = tileCenter(s.tx), y = tileCenter(s.ty);
    const target = nearest(alive, x, y, T.range);
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

function killEnemy(state, e) {
  const T = ENEMY_TYPES[e.kind];
  if (state.mode === 'camp') state.gold += T.gold;
  // 경험치 구슬 (모두에게 각자 보임)
  for (let i = 0; i < T.xp && state.orbs.length < MAX_ORBS; i++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
    state.orbs.push({ id: state.nextId++, x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, v: 1, taken: [], t: ORB_LIFE });
  }
  const shooter = state.players[e.lastHit];
  if (!shooter) return;
  shooter.score += T.score;
  const vamp = stats(shooter).vamp;
  if (vamp > 0 && shooter.alive && Math.random() < vamp) shooter.hp = Math.min(shooter.maxHp, shooter.hp + 1);
}

function bulletHitsWall(state, b, dt) {
  if (!wallAtPoint(state, b.x, b.y)) return false;
  if (b.bounce <= 0) return true;
  const px = b.x - b.vx * dt, py = b.y - b.vy * dt;
  b.bounce--;
  const hitX = wallAtPoint(state, b.x, py), hitY = wallAtPoint(state, px, b.y);
  if (hitX || !hitY) b.vx = -b.vx;
  if (hitY || !hitX) b.vy = -b.vy;
  b.x = px;
  b.y = py;
  return false;
}

function updateBullets(state, dt) {
  for (const b of state.bullets) {
    if (b.dead) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || bulletHitsWall(state, b, dt)) { b.dead = true; continue; }

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
      const s = structAt(state, Math.floor(b.x / TILE), Math.floor(b.y / TILE));
      if (s) { damageStruct(state, s, b.dmg); b.dead = true; continue; }
      for (const p of Object.values(state.players)) {
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

// ---------- 베이스캠프 모드: 웨이브 ----------
function campSpawnPoint(state) {
  const m = state.map, camp = m.camp;
  const alive = Object.values(state.players).filter((p) => p.alive);
  let x = tileCenter(2), y = tileCenter(2);
  for (let tries = 0; tries < 100; tries++) {
    const tx = 1 + Math.floor(Math.random() * (m.cols - 2));
    const ty = 1 + Math.floor(Math.random() * (m.rows - 2));
    if (isWallTile(state, tx, ty) || Math.hypot(tileCenter(tx) - camp.x, tileCenter(ty) - camp.y) < camp.r + TILE * 2) continue;
    x = tileCenter(tx); y = tileCenter(ty);
    if (alive.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 220 ** 2)) break;
  }
  return { x, y };
}

function updateCamp(state, players, dt) {
  if (state.enemies.length > 0) return;
  if (!state.cleared) {
    state.cleared = true;
    state.waveTimer = WAVE_BREAK;
    state.gold += 5 + state.wave * 2;
  }
  state.waveTimer -= dt;
  const alive = players.filter((p) => p.alive);
  if (state.waveTimer > 0 && !alive.every((p) => p.ready)) return;

  state.wave++;
  state.cleared = false;
  for (const p of players) {
    p.ready = false;
    if (!p.alive) revive(state, p, 0.5);
  }
  const count = Math.min(3 + state.wave * 2, 26);
  for (let i = 0; i < count; i++) {
    const { x, y } = campSpawnPoint(state);
    state.enemies.push(makeEnemy(state, pickKind(state.wave), x, y, Math.floor(state.wave / 5)));
  }
}

// ---------- 모험 모드: 방 / 포털 / 스테이지 ----------
function roomAt(state, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return state.map.rooms.find((r) => tx >= r.x0 + 1 && tx <= r.x0 + r.w - 2 && ty >= r.y0 + 1 && ty <= r.y0 + r.h - 2) || null;
}

function spawnRoomWave(state, room) {
  room.wavesLeft--;
  const idx = state.stageIdx;
  const alive = Object.values(state.players).filter((p) => p.alive);
  const count = Math.min(3 + Math.floor(idx * 0.6) + Math.max(0, alive.length - 1), 16);
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 60; tries++) {
      const tx = room.x0 + 1 + Math.floor(Math.random() * (room.w - 2));
      const ty = room.y0 + 1 + Math.floor(Math.random() * (room.h - 2));
      if (isWallTile(state, tx, ty)) continue;
      x = tileCenter(tx); y = tileCenter(ty);
      if (alive.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 150 ** 2)) break;
    }
    if (!x) continue;
    state.enemies.push(makeEnemy(state, pickKind(1 + idx), x, y, Math.floor(idx / 3)));
    addFx(state, { k: 'r', x, y, r: 18, c: '#ef5350', t: 0.3, life: 0.3 });
  }
  room.waveDelay = 0.8;
}

function activateRoom(state, room, enterer) {
  room.state = 'active';
  state.activeRoom = room;
  // 다른 팀원은 방 안으로 불러들입니다 (Soul Knight처럼).
  for (const p of Object.values(state.players)) {
    if (p === enterer || roomAt(state, p.x, p.y) === room) continue;
    p.x = enterer.x + (Math.random() - 0.5) * 20;
    p.y = enterer.y + (Math.random() - 0.5) * 20;
  }
  state.doorSet = new Set(room.doors.map(([tx, ty]) => tileKey(state, tx, ty)));
  const idx = state.stageIdx;
  room.wavesLeft = 1 + (idx >= 2 ? 1 : 0) + (idx >= 8 ? 1 : 0);
  spawnRoomWave(state, room);
}

function clearRoom(state, room) {
  room.state = 'cleared';
  state.activeRoom = null;
  state.doorSet = new Set();
  const alive = Object.values(state.players).filter((p) => p.alive);
  floatText(state, alive[0]?.x ?? 0, (alive[0]?.y ?? 0) - 30, '방 클리어!', '#a5d6a7', 1.2);
  for (const p of Object.values(state.players)) if (!p.alive && alive[0]) revive(state, p, 0.5, alive[0]);
}

function updateAdventure(state, players, dt) {
  const alive = players.filter((p) => p.alive);
  for (const p of alive) {
    const r = roomAt(state, p.x, p.y);
    if (r) r.seen = true;
  }

  const room = state.activeRoom;
  if (room) {
    if (state.enemies.length > 0) return;
    room.waveDelay -= dt;
    if (room.waveDelay > 0) return;
    if (room.wavesLeft > 0) spawnRoomWave(state, room);
    else clearRoom(state, room);
    return;
  }

  for (const p of alive) {
    const r = roomAt(state, p.x, p.y);
    if (r && r.type === 'battle' && r.state !== 'cleared') { activateRoom(state, r, p); return; }
  }

  // 포털: 살아 있는 팀원 전원이 포털 위에 모여야 출발
  const portal = state.map.portal;
  const onPortal = alive.length > 0 && alive.every((p) => Math.hypot(p.x - portal.x, p.y - portal.y) < 56);
  state.portalT = onPortal ? state.portalT + dt : 0;
  if (state.portalT >= 1) beginTransition(state);
}

function beginTransition(state) {
  state.phase = 'transition';
  state.transT = TRANSITION_TIME;
  state.portalT = 0;
  Object.assign(state, { enemies: [], bullets: [], orbs: [], fx: [] });
  for (const p of Object.values(state.players)) {
    p.reward = makeReward(p);
    p.rewardDone = false;
  }
}

function updateTransition(state, players, dt) {
  state.transT -= dt;
  if (state.transT > 0 && !players.every((p) => p.rewardDone)) return;
  for (const p of players) {
    if (!p.rewardDone && p.reward?.[0]) applyReward(p, p.reward[0]);
    p.reward = null;
    p.rewardDone = false;
  }
  state.stageIdx++;
  if (state.stageIdx >= WORLDS * STAGES_PER_WORLD) {
    endRun(state, '던전 정복! 🎉');
    return;
  }
  state.map = generateDungeon(state.stageIdx);
  state.doorSet = new Set();
  state.activeRoom = null;
  state.phase = 'playing';
  players.forEach((p, i) => {
    if (!p.alive) revive(state, p, 0.5);
    placeAtSpawn(state, p, i);
  });
}

// ---------- 한 틱 ----------
export function step(state, inputs, dt) {
  state.time += dt;
  const players = Object.values(state.players);
  for (const p of players) updatePlayer(state, p, inputs[p.id] || EMPTY_INPUT, dt);

  if (state.phase === 'over') {
    state.overT -= dt;
    if (state.overT <= 0) backToLobby(state);
    return;
  }
  if (state.phase === 'transition') { updateTransition(state, players, dt); return; }
  if (state.phase !== 'playing') return;

  const alive = players.filter((p) => p.alive);
  for (const e of state.enemies) updateEnemy(state, e, alive, dt);
  separateEnemies(state);
  updateTurrets(state, dt);
  updateBullets(state, dt);
  // 총알·지속 피해·반응 어떤 이유로든 쓰러진 적은 마지막으로 때린 사람에게 점수를 줍니다.
  for (const e of state.enemies) if (e.hp <= 0) killEnemy(state, e);
  state.enemies = state.enemies.filter((e) => e.hp > 0);

  for (const f of state.fx) f.t -= dt;
  state.fx = state.fx.filter((f) => f.t > 0);
  const ids = players.map((p) => p.id);
  for (const o of state.orbs) o.t -= dt;
  state.orbs = state.orbs.filter((o) => o.t > 0 && !ids.every((id) => o.taken.includes(id)));

  if (players.length === 0) return;
  if (!players.some((p) => p.alive)) {
    endRun(state, state.mode === 'camp' ? `전멸! (웨이브 ${state.wave})` : `전멸! (${stageLabel(state.stageIdx)})`);
    return;
  }
  if (state.mode === 'camp') updateCamp(state, players, dt);
  else updateAdventure(state, players, dt);
}

// ---------- 스냅샷 ----------
const r1 = (n) => Math.round(n * 10) / 10;

function statusCode(s) {
  return (s.burn > 0 ? 'b' : '') + (s.wet > 0 ? 'w' : '') + (s.chill > 0 ? 'c' : '')
    + (s.frozen > 0 ? 'f' : '') + (s.poison > 0 ? 'p' : '') + (s.stun > 0 ? 'z' : '');
}

function roomCode(r) {
  if (r.state === 'active') return 'a';
  if (r.state === 'cleared' || (r.seen && r.type !== 'battle')) return 'c';
  return r.seen ? 's' : '-';
}

// 화면에 그릴 데이터만 추린 가벼운 사본 (네트워크 전송용)
export function snapshot(state) {
  return {
    ph: state.phase,
    md: state.mode,
    hid: state.hostId,
    mid: state.map.id,
    lp: state.phase === 'lobby' ? lobbyProblem(state) : null,
    si: state.stageIdx,
    rs: state.map.rooms.map(roomCode).join(''),
    ar: state.activeRoom ? state.activeRoom.id : -1,
    pt: r1(state.portalT),
    tt: Math.ceil(state.transT),
    ot: state.overText,
    w: state.wave,
    wt: r1(Math.max(0, state.waveTimer)),
    g: state.gold,
    p: Object.values(state.players).map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y),
      a: Math.round(p.angle * 100) / 100, hp: p.hp, mh: p.maxHp,
      al: p.alive ? 1 : 0, s: p.score, iv: p.invuln > 0 ? 1 : 0,
      bf: p.buffs, of: p.offer, oq: p.offerQueue, rd: p.ready ? 1 : 0,
      el: p.element, elv: p.elementLv, pz: p.paused ? 1 : 0, wp: p.weapon,
      lv: p.level, xp: Math.floor(p.xp), xn: xpToNext(p.level),
      rw: p.reward, rwd: p.rewardDone ? 1 : 0,
    })),
    e: state.enemies.map((e) => ({
      id: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), r: e.r,
      hp: e.hp, mh: e.maxHp, h: e.hitT > 0 ? 1 : 0, s: statusCode(e.st),
    })),
    st: state.structs.map((s) => ({
      id: s.id, k: s.kind, tx: s.tx, ty: s.ty, hp: s.hp, mh: s.maxHp,
      a: s.angle !== undefined ? Math.round(s.angle * 100) / 100 : 0,
    })),
    b: state.bullets.map((b) => ({ x: r1(b.x), y: r1(b.y), r: b.r, o: b.owner === 'p' ? 0 : 1, el: b.el || 0, k: b.kind || 0, a: b.kind === 'bow' ? Math.round(Math.atan2(b.vy, b.vx) * 100) / 100 : 0 })),
    xo: state.orbs.map((o) => ({ id: o.id, x: r1(o.x), y: r1(o.y), tk: o.taken })),
    fx: state.fx.map((f) => ({ ...f, x: r1(f.x), y: r1(f.y), t: r1(f.t) })),
  };
}

