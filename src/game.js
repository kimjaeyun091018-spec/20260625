// 게임 규칙과 시뮬레이션 (화면/네트워크 코드 없음)
// 멀티플레이에서는 방장(호스트)의 브라우저만 이 시뮬레이션을 돌리고,
// 참가자들은 입력만 보내고 결과(스냅샷)를 받아서 그립니다.
//
// 흐름: lobby(걸어 다니는 방: 캐릭터 동상·포털) → playing → (모험) transition(스테이지 보상·전직) → … → over → lobby

import {
  TILE, MAX_PLAYERS, WEAPONS, START_WEAPON, weaponFam, SKILLS, WEAPON_SLOTS, SWAP_COOLDOWN, RESONANCE, COMBO_EVERY,
  DROP_TIERS, DROP_ELEMENT_CHANCE, CHARACTERS, CHARACTER_KEYS, ENEMY_TYPES, STRUCTS, BUFFS,
  ELEMENTS, ELEMENT_MAX, ELEMENT_MAX_BONUS, MAX_AUGMENT_TYPES, STAGE_REWARDS, STAGES_PER_WORLD, WORLDS, ESSENCE,
  BOSSES, SHOP, SURVIVAL, CASTLE, UNITS, ARMY_CAP, unitScale, guildPerks, SPOILS, SUPPLIES, TRAPS, stageLabel, xpToNext, enemyScale, MANA, activeManaCost, CHARGE, KEEP, ROUND, BARRACKS, CAMP_SHOP, SKINS, baseSkin, TREASURES, TREASURE_KEYS, TREASURE_DUP_ESSENCE, TREASURE_CHEST_CHANCE, ESSENCE_MUL,
} from './data.js';
import { buildCampMap, buildLobbyMap, generateDungeon, tileCenter } from './maps.js';
import { ACTIVES, PERKS, NODE, LOADOUT_SIZE, sanitizeBuild, buildBonus } from './tree.js';

// 1P 빨강 · 2P 초록 · 3P 파랑 · 4P 노랑 (발밑 고리·이름 색)
const PLAYER_COLORS = ['#ef5350', '#66bb6a', '#42a5f5', '#ffee58'];
const PLAYER_RADIUS = 12;
const PLAYER_SPEED = 190;
const DASH_SPEED = 560;
const DASH_TIME = 0.14;
const DASH_COOLDOWN = 0.9;
const WAVE_BREAK = 12;
const FIRST_BREAK = 10;
const OVER_DELAY = 4;
const START_GOLD = 20;
const CAMP_HEAL_EVERY = 5;
const MAX_STRUCTS = 40;
const MAX_ORBS = 260;
const ORB_RANGE = 42;
const KNIGHT_SHIELD = 4;
const ORB_LIFE = 45;
const TRANSITION_TIME = 30;
const INTERACT_RANGE = 48;
const PORTAL_RANGE = 56;
const SWING_TIME = 0.18;

const ACTION_RE = /^(fence|turret|demolish|ready|skill|ult|swap|castle|evoskip|evo[1-4]|cast[1-4]|sum[1-4]|pick[1-3]|reward[1-3])$/;

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
  return s || '모험가';
}

// ---------- 상태 ----------
function runLists() {
  return {
    enemies: [], bullets: [], structs: [], structMap: new Map(), fx: [], orbs: [],
    grenades: [], zones: [], chests: [], pickups: [], shop: [], hazards: [], barrels: [], units: [], castle: null,
    doorSet: new Set(), activeRoom: null, portalT: 0, chestsThisStage: 0,
    lobbyPortal: null, lobbyPortalT: 0,
  };
}

export function createState(hostId) {
  return {
    hostId,
    phase: 'lobby',
    mode: 'adv',
    runId: 0,
    time: 0,
    nextId: 1,
    players: {},
    ...runLists(),
    map: buildLobbyMap(CHARACTER_KEYS),
    stageIdx: 0,
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
  const c = state.castle;
  if (c && (x - c.x) ** 2 + (y - c.y) ** 2 < (r + c.r) ** 2) return 'wall'; // 성은 벽처럼 막음
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
  // 이미 벽에 살짝 박혀 있으면(벽 옆에 나타난 큰 적 등) 막지 않고 빠져나오게
  if (circleBlocked(state, e.x, e.y, e.r, false) === 'wall' && !circleBlocked(state, e.x + dx, e.y + dy, e.r * 0.5, false)) {
    e.x += dx; e.y += dy;
    return null;
  }
  let hitStruct = null;
  const hx = circleBlocked(state, e.x + dx, e.y, e.r, structsBlock);
  if (!hx) e.x += dx; else if (hx !== 'wall') hitStruct = hx;
  const hy = circleBlocked(state, e.x, e.y + dy, e.r, structsBlock);
  if (!hy) e.y += dy; else if (hy !== 'wall') hitStruct = hy;
  return hitStruct;
}

// ---------- 적 길찾기 ----------
// 목표가 벽 너머에 있으면 목표 칸에서 거꾸로 넓혀 가는 거리 지도(흐름장)를 따라 벽을 돌아갑니다.
// 목표 칸마다 0.35초씩 재사용, 반경 48칸까지만 계산. 성은 장애물로 칩니다.
const FLOW_RADIUS = 48;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function flowBlocked(state, tx, ty, big = false, toCastle = false) {
  if (isWallTile(state, tx, ty)) return true;
  const c = state.castle;
  if (c && !toCastle && (tileCenter(tx) - c.x) ** 2 + (tileCenter(ty) - c.y) ** 2 < (c.r + 14) ** 2) return true;
  // 덩치 큰 적은 한 칸짜리 틈을 못 지나감
  if (big && ((isWallTile(state, tx - 1, ty) && isWallTile(state, tx + 1, ty)) || (isWallTile(state, tx, ty - 1) && isWallTile(state, tx, ty + 1)))) return true;
  return false;
}
function flowField(state, tx, ty, big = false, toCastle = false) {
  const m = state.map;
  const cache = m.flow || (m.flow = new Map());
  const key = (ty * m.cols + tx) * 4 + (big ? 1 : 0) + (toCastle ? 2 : 0);
  const start = ty * m.cols + tx;
  const hit = cache.get(key);
  if (hit && state.time - hit.t < 0.35) return hit;
  if (cache.size > 48) for (const [k, v] of cache) if (state.time - v.t > 0.35) cache.delete(k);
  const dist = new Int16Array(m.cols * m.rows).fill(-1);
  const q = new Int32Array(m.cols * m.rows);
  let head = 0, tail = 0;
  if (tx >= 0 && ty >= 0 && tx < m.cols && ty < m.rows) { dist[start] = 0; q[tail++] = start; }
  while (head < tail) {
    const i = q[head++], x = i % m.cols, y = (i / m.cols) | 0, d = dist[i];
    if (d >= FLOW_RADIUS) continue;
    for (const [ox, oy] of DIRS8) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue;
      const j = ny * m.cols + nx;
      if (dist[j] >= 0 || flowBlocked(state, nx, ny, big, toCastle)) continue;
      if (ox && oy && (flowBlocked(state, x + ox, y, big, toCastle) || flowBlocked(state, x, y + oy, big, toCastle))) continue; // 모서리 대각선 금지
      dist[j] = d + 1;
      q[tail++] = j;
    }
  }
  const f = { t: state.time, dist, cols: m.cols };
  cache.set(key, f);
  return f;
}
// 몸 폭(r)을 생각해서 직선으로 갈 수 있는지
function clearLine(state, x0, y0, x1, y1, r, toCastle = false) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1) return true;
  const nx = (-(y1 - y0) / d) * r * 0.8, ny = ((x1 - x0) / d) * r * 0.8;
  const n = Math.ceil(d / 10);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (const k of [0, 1, -1]) if (isWallTile(state, Math.floor((x + nx * k) / TILE), Math.floor((y + ny * k) / TILE))) return false;
  }
  const c = state.castle;
  if (c && !toCastle) {
    // 선분과 성(원)의 거리
    const t = Math.max(0, Math.min(1, ((c.x - x0) * (x1 - x0) + (c.y - y0) * (y1 - y0)) / (d * d)));
    if (Math.hypot(x0 + (x1 - x0) * t - c.x, y0 + (y1 - y0) * t - c.y) < c.r + r) return false;
  }
  return true;
}
// 움직일 방향: 보이면 null(직진), 벽 너머면 흐름장에서 거리가 가장 짧아지는 이웃 칸 쪽
function pathDir(state, e, target, dt) {
  const toCastle = !!state.castle && target === state.castle;
  e.losT = (e.losT || 0) - dt;
  if (e.losT <= 0) { e.losT = 0.2 + Math.random() * 0.1; e.los = clearLine(state, e.x, e.y, target.x, target.y, e.r, toCastle); }
  if (e.los) return null;
  const big = e.r > 14;
  const f = flowField(state, Math.floor(target.x / TILE), Math.floor(target.y / TILE), big, toCastle);
  const ex = Math.floor(e.x / TILE), ey = Math.floor(e.y / TILE);
  let best = null, bestD = f.dist[ey * f.cols + ex];
  if (bestD < 0) bestD = 1e9;
  for (const [ox, oy] of DIRS8) {
    const nx = ex + ox, ny = ey + oy;
    if (nx < 0 || ny < 0 || nx >= f.cols) continue;
    const d = f.dist[ny * f.cols + nx];
    if (d < 0 || d >= bestD) continue;
    if (ox && oy && (flowBlocked(state, ex + ox, ey, big, toCastle) || flowBlocked(state, ex, ey + oy, big, toCastle))) continue;
    bestD = d; best = [nx, ny];
  }
  if (!best) return null;
  const dx = tileCenter(best[0]) - e.x, dy = tileCenter(best[1]) - e.y, l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

// 빠른 적의 회피: 날아오는 플레이어 총알을 보면 옆으로 휙 (쿨타임마다 확률)
const DODGE = { bat: { cd: 1.4, chance: 0.6 }, bomber: { cd: 2, chance: 0.6 }, spider: { cd: 2.2, chance: 0.5 } };
function tryDodge(state, e, dt) {
  const D = DODGE[e.kind];
  e.dodgeCd = (e.dodgeCd || 0) - dt;
  if (e.dodgeCd > 0) return;
  e.scanT = (e.scanT || 0) - dt;
  if (e.scanT > 0) return;
  e.scanT = 0.08;
  for (const b of state.bullets) {
    if (b.owner !== 'p') continue;
    const bs = Math.hypot(b.vx, b.vy);
    if (bs < 1) continue;
    const bx = b.vx / bs, by = b.vy / bs, rx = e.x - b.x, ry = e.y - b.y;
    const along = rx * bx + ry * by;
    if (along < 0 || along > 160) continue;
    const side = rx * -by + ry * bx; // 총알 진행선에서 얼마나 옆에 있는지
    if (Math.abs(side) > e.r + 12) continue;
    e.dodgeCd = D.cd * (0.8 + Math.random() * 0.4);
    if (Math.random() > D.chance) return; // 이번엔 못 봄
    const sgn = side === 0 ? (Math.random() < 0.5 ? 1 : -1) : Math.sign(side);
    e.dvx = -by * sgn; e.dvy = bx * sgn;
    e.dodgeT = 0.2;
    addFx(state, { k: 'r', x: e.x, y: e.y, r: e.r + 4, c: '#b0bec5', t: 0.25, life: 0.25 });
    return;
  }
}

// 벽을 뚫지 않게 잘게 나눠 밀기 (넉백). 보스는 거의 밀리지 않습니다.
function push(state, e, ux, uy, dist) {
  if (e.kind === 'boss') dist *= 0.1;
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
  if (state.fx.length < 140) state.fx.push(fx);
}

function floatText(state, x, y, text, c, life = 0.8) {
  addFx(state, { k: 't', x, y, text, c, t: life, life });
}

// 바닥 칸 하나를 찾아 그 중심 (방 가운데 기둥 피하기)
function freeSpotNear(state, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let r = 0; r < 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!isWallTile(state, tx + dx, ty + dy)) return { x: tileCenter(tx + dx), y: tileCenter(ty + dy) };
      }
    }
  }
  return { x, y };
}

// 조준 방향으로 최대 maxD만큼 떨어진 지점 (마우스가 더 가까우면 마우스 위치)
function aimPoint(p, inp, maxD) {
  const d = Math.min(maxD, Math.hypot(inp.bx - p.x, inp.by - p.y));
  return { x: p.x + Math.cos(p.angle) * d, y: p.y + Math.sin(p.angle) * d };
}

// ---------- 무기 칸 ----------
// el/elv: 무기에 붙은 속성과 레벨 (속성 카드는 '들고 있는 무기'에 속성을 붙임)
function newSlot(key, el = null, elv = 0) {
  return { key, el: el || null, elv: el ? Math.max(1, elv || 1) : 0, ult: 0, cd: 0, charges: WEAPONS[key].charges || 1 };
}

const held = (p) => p.weapons[p.slot] || p.weapons[0];
const heldFam = (p) => weaponFam(held(p)?.key);
const skillCdOf = (key) => WEAPONS[key].skillCd || SKILLS[weaponFam(key)].skill.cd;
const charOf = (p) => CHARACTERS[p.char] || CHARACTERS.knight;
const maxHpOf = (p) => p.maxHp + (heldFam(p) === 'hammer' ? 2 : 0); // 해머 패시브: 강철 몸
const weaponSlotsOf = (p) => WEAPON_SLOTS + (p.bonus.slot ? 1 : 0);
const hasPerk = (p, k) => !!p?.perks?.includes(k);

// 공격 한 번(한 발 묶음)에 붙는 속성
// - 무기 속성 = 캐릭터 속성: 공명 (레벨 +1, 피해 ×1.2)
// - 무기 속성 ≠ 캐릭터 속성: 결합 (3번째 공격마다 캐릭터 속성도 함께 → 원소 반응)
// - 무기에 속성이 없으면 캐릭터 속성
// count=true면 결합 횟수를 셉니다 (실제 공격할 때만)
function attackElement(p, count = false) {
  const s = held(p);
  if (s?.el) {
    const resonance = !!p.element && s.el === p.element;
    let el2 = null, elv2 = 0;
    if (!resonance && p.element) {
      if (count) p.comboN = (p.comboN + 1) % COMBO_EVERY;
      if (count && p.comboN === 0) { el2 = p.element; elv2 = p.elementLv; }
    }
    return { el: s.el, elv: resonance ? Math.min(ELEMENT_MAX_BONUS + 1, s.elv + 1) : s.elv, resonance, el2, elv2 };
  }
  return { el: p.element, elv: p.elementLv, resonance: false, el2: null, elv2: 0 };
}

// 궁극기 게이지 충전 (들고 있는 무기가 그 계열·방식일 때만)
function chargeUlt(p, fam, type, amount) {
  const s = held(p);
  if (!s || weaponFam(s.key) !== fam) return;
  const def = SKILLS[fam].ult;
  if (def.type !== type || p.ultT > 0) return;
  const mult = (attackElement(p).resonance ? RESONANCE.ult : 1) * p.bonus.ultMul;
  s.ult = Math.min(def.need, s.ult + amount * mult);
}

// ---------- 플레이어 ----------
function usedColor(state, color) {
  return Object.values(state.players).some((p) => p.color === color);
}

function freshRunStats(p) {
  const C = charOf(p);
  Object.assign(p, {
    hp: C.hp, maxHp: C.hp, alive: true, score: 0, invuln: 1.5, trRun: [],
    fireCd: 0, dashCd: 0, dashT: 0, healT: 0, moving: false, es: 0, coins: 0,
    buffs: {}, augTypes: [], offer: null, offerQueue: 0, element: null, elementLv: 0,
    level: 1, xp: 0, ready: false, reward: null, rewardDone: false, evo: null, evoDone: true, rewardsTaken: [],
    bonus: { dmgPct: 0, rate: 0, speed: 0, xpMul: 1, iron: false, vamp: 0, slot: false, cdMul: 1, phoenix: false, essMul: 1, ultMul: 1, coinMul: 1 },
    mana: C.mana, manaMsgT: 0, comboN: 0, shieldT: 0, dsx: 0, dsy: 0, crowns: 0, spoils: 0, trainQ: [], trainT: 0, sumCd: {}, reviveT: SURVIVAL.reviveTime, poisonT: 0, runMode: null,
    weapons: [newSlot(START_WEAPON)], slot: 0, swapCd: 0,
    parry: 0, markId: null, markN: 0, spin: 0, spinIdle: 0, chargeT: 0,
    sdash: null, dashHits: [], javelin: null, ultT: 0, ultTick: 0, ultStep: 0,
    loadout: [], casts: [0, 0, 0, 0], perks: [], staticT: 0, swingT: 0, swingDir: 1,
  });
}

// 로비 스킬 트리 빌드를 이번 판에 적용
function applySupplies(p) {
  const s = p.supplies || {};
  if (s.weapon) { const d = randomWeaponDrop({ mode: 'adv', stageIdx: 0 }, 2); p.weapons.push(newSlot(d.key, d.el, d.elv)); }
  if (s.coins) p.coins += 40;
  if (s.heart) { p.maxHp += 2; p.hp = p.maxHp; }
  if (s.card) { p.offerQueue++; nextOffer(p); }
  if (s.element) { const w = p.weapons[0]; w.el = shuffle(Object.keys(ELEMENTS))[0]; w.elv = 2; }
}

function applyBuild(p) {
  const b = p.build || { el: null, eq: [], nodes: [] };
  const bb = buildBonus(b);
  p.maxHp += bb.hp;
  p.hp = p.maxHp;
  p.bonus.dmgPct += bb.dmgPct;
  p.skin = skinFor(p);
  p.bonus.speed += bb.speed;
  p.bonus.xpMul += bb.xp;
  p.bonus.essMul += bb.ess;
  p.bonus.cdMul *= 1 - bb.cd;
  if (b.el) {
    p.element = b.el;
    p.elementLv = 1 + bb.elLv;
  }
  // 액티브 칸(1~3 키)과 패시브 칸(항상 켜짐)을 따로
  p.bb = bb;
  // 보급관에서 산 보급품 (모험 모드에서만, 한 번 쓰면 로비에서 사라짐)
  p.supplies = b.supplies || {};
  p.army = b.army || { sel: [], lv: {} };
  p.guild = b.guild || null;
  if (p.guild) { const gp = guildPerks(p.guild.lv); p.bonus.essMul += gp.ess; p.bonus.dmgPct += gp.dmg; }
  p.bonus.coinMul += bb.coin;
  if (bb.phoenix) p.bonus.phoenix = true;
  p.loadout = b.eq.filter((id) => NODE[id].kind === 'active');
  p.casts = p.loadout.map(() => 0);
  p.perkIds = b.eq.filter((id) => NODE[id].kind === 'perk');
  p.perks = p.perkIds.map((id) => NODE[id].perk);
}

// 캐릭터마다 입은 스킨
const skinFor = (p) => p.build?.skinOf?.[p.char] || baseSkin(p.char);
const ownsChar = (p, k) => !p.build || p.build.chars.includes(k);

export function setBuild(state, id, build) {
  const p = state.players[id];
  if (!p) return;
  p.build = sanitizeBuild(build);
  // 산 캐릭터가 아니면 산 캐릭터 중 하나로 (로비에서만)
  if (state.phase === 'lobby' && !ownsChar(p, p.char)) {
    p.char = p.build.chars[0] || 'knight';
  }
  p.skin = skinFor(p); // 로비에서도 스킨이 바로 보이도록
  // 로비에서는 속성·장착 스킬을 바로 시험해 볼 수 있게 적용
  if (state.phase === 'lobby') { freshRunStats(p); applyBuild(p); p.invuln = 0; }
  else if (state.mode === 'camp' && id === state.hostId) applyKeep(state); // 성 강화 화면에서 바꾸면 바로 적용
}

export function addPlayer(state, id, name) {
  if (state.players[id]) return state.players[id];
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const color = PLAYER_COLORS.find((c) => !usedColor(state, c)) ?? PLAYER_COLORS[0];
  const p = {
    id, name: sanitizeName(name), color, x: 0, y: 0, r: PLAYER_RADIUS,
    angle: 0, char: pickFreeChar(state), lastSeq: 0, paused: false, dashX: 0, dashY: 0, build: null, skin: 'kn_base',
  };
  freshRunStats(p);
  // 게임 도중 들어오면 관전(쓰러진 상태)으로 시작해서 다음 부활 때 합류합니다.
  if (state.phase !== 'lobby') {
    p.alive = false;
    p.hp = 0;
    p.runMode = state.mode;
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

function pickFreeChar() {
  return 'knight'; // 모두 기사로 시작 (같은 캐릭터 여러 명 가능)
}

function stats(p) {
  const b = p.buffs, B = p.bonus;
  const s = held(p);
  const W = WEAPONS[s?.key] || WEAPONS[START_WEAPON];
  const fam = W.fam;
  const gunUlt = fam === 'gun' && p.ultT > 0;
  const tail = hasPerk(p, 'tailwind');
  const ch = p.char;
  const ae = attackElement(p);
  // 광전사: 잃은 체력 1칸마다 피해 +8%
  const rage = ch === 'berserker' ? 0.08 * Math.max(0, maxHpOf(p) - p.hp) : 0;
  const mul = (1 + 0.12 * (b.dmg || 0) + B.dmgPct + rage) * (ae.resonance ? RESONANCE.dmg : 1);
  const rate = (1 + 0.08 * (b.rate || 0) + B.rate) * (1 + (fam === 'gun' ? p.spin : 0)) * (gunUlt ? 3 : 1);
  return {
    W, fam, mul,
    dmg: W.dmg * mul,
    // 저격총·쇠뇌·샷건은 최소 간격(minCd)보다 빨라지지 않음
    cd: Math.max(gunUlt ? 0 : W.minCd || 0, W.cd / rate),
    crit: Math.min(0.9, (W.crit || 0) + 0.05 * (b.crit || 0) + (ch === 'rogue' ? 0.15 : 0) + (p.bb?.crit || 0)),
    critX: (W.critX || 2) + (ch === 'rogue' ? 0.5 : 0),
    inacc: (W.inacc || 0) + (gunUlt ? 0.3 : 0),
    shots: 1 + (b.multi || 0),
    speed: PLAYER_SPEED * (1 + 0.06 * (b.speed || 0) + B.speed + (tail ? 0.08 : 0) + (ch === 'ranger' ? 0.15 : 0)) * (p.slowT > 0 ? TRAPS.poison.slow : 1),
    pierce: (W.pierce || 0) + (b.pierce || 0),
    bounce: b.bounce || 0,
    reach: 1 + 0.1 * (b.reach || 0),
    dashCd: DASH_COOLDOWN * 0.88 ** (b.dash || 0) * (B.iron ? 0.7 : 1) * (tail ? 0.7 : 1) * (ch === 'ranger' ? 0.7 : 1) * (1 - (p.bb?.dash || 0)),
    vamp: B.vamp,
    maxMana: charOf(p).mana + 25 * (b.mana || 0) + (p.bb?.mana || 0),
    manaGain: (1 + 0.15 * (b.mana || 0) + (p.bb?.manaGain || 0)) * (ch === 'mage' ? 1.5 : 1),
  };
}

function heal(p, n) {
  p.hp = Math.min(maxHpOf(p), p.hp + n);
}

function damagePlayer(state, p, dmg) {
  if (!p.alive || p.invuln > 0) return;
  p.hp -= dmg;
  p.invuln = 0.7 * (p.bonus.iron ? 2 : 1);
  chargeUlt(p, 'hammer', 'gauge', dmg * 4); // 해머 궁극기: 받은 피해로도 충전
  if (hasPerk(p, 'frostarmor')) {
    for (const e of enemiesNear(state, p.x, p.y, 140)) { e.st.chill = Math.max(e.st.chill, 2); }
    addFx(state, { k: 'r', x: p.x, y: p.y, r: 140, c: '#b2ebf2', t: 0.3, life: 0.3 });
  }
  if (p.hp <= 0) {
    if (p.bonus.phoenix) {
      // 불사조의 깃털: 한 번만 즉시 부활
      p.bonus.phoenix = false;
      p.hp = Math.ceil(maxHpOf(p) / 2);
      p.invuln = 2;
      floatText(state, p.x, p.y - 30, '불사조!', '#ff8a65', 1.2);
      addFx(state, { k: 'r', x: p.x, y: p.y, r: 90, c: '#ff8a65', t: 0.5, life: 0.5 });
      return;
    }
    p.hp = 0;
    p.alive = false;
    p.ready = false;
    p.ultT = 0;
    p.sdash = null;
  }
}

function revive(state, p, hpRatio, near) {
  p.alive = true;
  p.hp = Math.max(1, Math.ceil(maxHpOf(p) * hpRatio));
  p.invuln = 1.5;
  if (near) { p.x = near.x; p.y = near.y; }
}

function giveEssence(state, amount) {
  for (const p of Object.values(state.players)) p.es += amount * ESSENCE_MUL * p.bonus.essMul;
}

// ---------- 모험 보물 ----------
const ownsTreasure = (p, k) => !!p.build?.tr?.includes(k);
function giveTreasure(state, p) {
  if (!p.trRun) p.trRun = [];
  const pool = TREASURE_KEYS.filter((k) => !ownsTreasure(p, k) && !p.trRun.includes(k));
  if (!pool.length) {
    p.es += TREASURE_DUP_ESSENCE;
    floatText(state, p.x, p.y - 48, `보물을 다 모았어요! ◆${TREASURE_DUP_ESSENCE}`, '#80deea', 1.8);
    return;
  }
  const k = pool[Math.floor(Math.random() * pool.length)];
  p.trRun.push(k);
  floatText(state, p.x, p.y - 48, `보물: ${TREASURES[k].name}!`, '#ffd54f', 2.2);
  addFx(state, { k: 'r', x: p.x, y: p.y, r: 50, c: '#ffd54f', t: 0.6, life: 0.6 });
}

// ---------- 증강 (레벨업) ----------
// 증강 종류는 한 판에 최대 5종류 (속성 카드도 1종류). 5종류를 채우면 가진 것만 레벨업 카드로 나옵니다.
function makeOffer(p) {
  if (p.runMode === 'camp') return null; // 성 지키기에는 증강 없음
  const kind = WEAPONS[held(p).key].kind;
  const ranged = kind === 'ranged';
  const full = p.augTypes.length >= MAX_AUGMENT_TYPES;
  const buffs = Object.keys(BUFFS).filter((k) => {
    const d = BUFFS[k];
    if (d.ranged && !ranged) return false;
    if (d.melee && ranged) return false;
    if (full && !p.augTypes.includes(k)) return false;
    return (p.buffs[k] || 0) < d.max;
  });
  // 속성 카드: 들고 있는 무기에 속성을 붙임 (같은 속성이면 레벨 업)
  const w = held(p);
  let elements = Object.keys(ELEMENTS)
    .filter((k) => !(w.el === k && w.elv >= ELEMENT_MAX))
    .map((k) => `el:${k}`);
  if (full) elements = p.augTypes.includes('el') && w.el && w.elv < ELEMENT_MAX ? [`el:${w.el}`] : [];
  const offer = shuffle([...buffs, ...elements]).slice(0, 3);
  if (!w.el && elements.length && !offer.some((k) => k.startsWith('el:'))) {
    offer[offer.length - 1] = shuffle(elements)[0];
  }
  return offer.length ? offer : null;
}

function applyBuff(p, key) {
  const type = key.startsWith('el:') ? 'el' : key;
  if (!p.augTypes.includes(type)) p.augTypes.push(type);
  if (key.startsWith('el:')) {
    const k = key.slice(3), w = held(p);
    if (w.el === k) w.elv = Math.min(ELEMENT_MAX, w.elv + 1);
    else { w.el = k; w.elv = 1; }
    return;
  }
  p.buffs[key] = (p.buffs[key] || 0) + 1;
  if (key === 'hp') {
    p.maxHp += 1;
    if (p.alive) p.hp += 1;
  }
}

function nextOffer(p) {
  while (!p.offer && p.offerQueue > 0) {
    p.offerQueue--;
    p.offer = makeOffer(p); // 고를 게 없으면 그 레벨업은 넘어감
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

// ---------- 스테이지 보상 & 전직 ----------
function makeReward(p) {
  const keys = Object.keys(STAGE_REWARDS).filter((k) => {
    if (p.rewardsTaken.includes(k)) return false; // 종류마다 1번만
    if (k === 'awaken') return !(p.element && p.elementLv >= ELEMENT_MAX_BONUS);
    return true;
  });
  const pick = shuffle(keys).slice(0, 3).map((k) => `rw:${k}`);
  while (pick.length < 3 && !pick.includes('rw:rest')) pick.push('rw:rest');
  return pick;
}

function applyReward(p, key) {
  const k = key.slice(3);
  const B = p.bonus;
  if (k === 'rest') { p.hp = maxHpOf(p); return; }
  p.rewardsTaken.push(k);
  if (k === 'awaken') {
    if (p.element) p.elementLv = Math.min(ELEMENT_MAX_BONUS, p.elementLv + 1);
    else { p.element = shuffle(Object.keys(ELEMENTS))[0]; p.elementLv = 2; }
  } else if (k === 'heart') {
    p.maxHp += 2;
    p.hp = maxHpOf(p);
  } else if (k === 'might') B.dmgPct += 0.2;
  else if (k === 'gale') B.rate += 0.2;
  else if (k === 'wisdom') B.xpMul += 0.5;
  else if (k === 'iron') B.iron = true;
  else if (k === 'vamp') B.vamp = 0.15;
  else if (k === 'slot') B.slot = true;
  else if (k === 'focus') B.cdMul *= 0.75;
  else if (k === 'phoenix') B.phoenix = true;
  else if (k === 'coin') { B.essMul += 0.5; B.coinMul += 0.5; }
  else if (k === 'surge') B.ultMul += 0.3;
}

function evolve(p, key) {
  const s = held(p);
  if (!s || !WEAPONS[s.key].evo?.includes(key)) return;
  s.key = key;            // 진화한 무기는 별개의 무기 (속성은 그대로)
  s.charges = WEAPONS[key].charges || 1;
  s.cd = 0;
  s.ult = 0;
}

// ---------- 로비 ----------
export function lobbyProblem(state) {
  const players = Object.values(state.players);
  const none = players.find((p) => !ownsChar(p, p.char));
  if (none) return `${none.name}: 산 캐릭터로 바꿔 주세요 (캐릭터 동상)`;
  return null; // 같은 캐릭터를 여러 명이 골라도 됨
}

// 로비에서 E: 가까운 캐릭터 동상의 캐릭터로 바꿉니다.
function lobbyInteract(state, p) {
  const st = nearest(state.map.lobby.statues, p.x, p.y, INTERACT_RANGE + 8);
  if (!st) return;
  const k = st.key;
  if (p.char === k) return;
  if (!ownsChar(p, k)) {
    floatText(state, st.x, st.y - 30, '아직 사지 않은 캐릭터', '#ef9a9a', 1);
    return;
  }
  p.char = k;
  p.skin = skinFor(p);
  freshRunStats(p);
  applyBuild(p);
  p.invuln = 0;
  floatText(state, p.x, p.y - 34, CHARACTERS[k].name, CHARACTERS[k].color, 0.9);
}

// 로비 포털: 모두가 같은 포털 위에 모이면 그 모드로 출발
function updateLobby(state, players, dt) {
  const portals = state.map.lobby.portals;
  const here = portals.find((pt) => players.length > 0 && players.every((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < PORTAL_RANGE));
  if (!here) { state.lobbyPortal = null; state.lobbyPortalT = 0; return; }
  if (state.lobbyPortal !== here.mode) { state.lobbyPortal = here.mode; state.lobbyPortalT = 0; }
  state.lobbyPortalT += dt;
  const problem = lobbyProblem(state);
  if (problem) return; // 화면에 '출발할 수 없어요' 배너가 이유를 보여 줌
  if (state.lobbyPortalT >= 1.2) {
    state.mode = here.mode;
    startRun(state);
  }
}

function startRun(state) {
  Object.assign(state, runLists());
  state.runId++;
  for (const p of Object.values(state.players)) {
    freshRunStats(p); applyBuild(p); p.runMode = state.mode;
    if (state.mode === 'camp') { p.maxHp += SURVIVAL.bonusHp; p.hp = p.maxHp; } // 생존 모드는 체력 여유
  }
  if (state.mode === 'adv') for (const p of Object.values(state.players)) applySupplies(p);
  // 길드 시너지: 같은 방에 같은 길드원이 있으면 1명마다 피해 +5%
  const all = Object.values(state.players);
  for (const p of all) {
    const mates = p.guild ? all.filter((o) => o !== p && o.guild?.id === p.guild.id).length : 0;
    p.bonus.dmgPct += 0.05 * mates;
    p.guildMates = mates;
  }
  state.phase = 'playing';
  state.overText = '';
  if (state.mode === 'camp') {
    // 성 키우기: 방장의 성(저장된 라운드·성 레벨·거치 무기)으로 시작. 바로 싸우지 않고 준비 단계에서 G로 시작
    const keep = state.players[state.hostId]?.build?.keep || { round: 1, lv: 1, mounts: [] };
    Object.assign(state, { gold: START_GOLD, wave: 0, waveTimer: 0, cleared: true, survT: 0, started: false, kills: 0,
      round: keep.round, campPhase: 'prep', toSpawn: 0, spawnT: 0, clears: 0, defeats: 0, roundBoss: false });
    state.map = buildCampMap();
    setupCastle(state);
    setupCampShop(state);
  } else {
    state.stageIdx = 0;
    state.map = generateDungeon(0, { boss: isBossStage(0) });
    setupStageRooms(state);
  }
  loadTraps(state);
  Object.values(state.players).forEach((p, i) => placeAtSpawn(state, p, i));
}

const isBossStage = (idx) => idx % STAGES_PER_WORLD === STAGES_PER_WORLD - 1;

function endRun(state, text) {
  state.phase = 'over';
  state.overText = text;
  state.overT = OVER_DELAY;
}

function backToLobby(state) {
  Object.assign(state, runLists());
  state.phase = 'lobby';
  state.map = buildLobbyMap(CHARACTER_KEYS);
  Object.values(state.players).forEach((p, i) => { freshRunStats(p); placeAtSpawn(state, p, i); });
}

// ---------- 베이스캠프 건설 ----------
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
  const hp = def.hp + (kind === 'fence' && ownsTreasure(p, 'b_fence') ? 10 : 0); // 강철 울타리 설계도
  const fast = kind === 'turret' && ownsTreasure(p, 'b_turret');              // 연발 터렛 설계도
  state.structs.push({ id: state.nextId++, kind, tx, ty, hp, maxHp: hp, cd: 0, owner: p.id, fast });
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

// ---------- 보물상자 & 무기 줍기 & 상점 ----------
function spawnChest(state, x, y, big = false) {
  const spot = freeSpotNear(state, x, y);
  state.chests.push({ id: state.nextId++, x: spot.x, y: spot.y, open: false, big });
  state.chestsThisStage++;
}

// 지금 월드(모험) 또는 웨이브(캠프)에 맞는 무기 하나: 단계(1~3)와 속성(있음/없음)을 무작위로
function worldOf(state) {
  return state.mode === 'camp' ? Math.min(2, Math.floor(state.wave / 4)) : Math.min(2, Math.floor(state.stageIdx / STAGES_PER_WORLD));
}

function randomWeaponDrop(state, minTier = 1) {
  const probs = DROP_TIERS[worldOf(state)];
  let r = Math.random(), tier = 1;
  for (let i = 0; i < probs.length; i++) { if (r < probs[i]) { tier = i + 1; break; } r -= probs[i]; tier = i + 2; }
  tier = Math.max(minTier, Math.min(3, tier));
  const keys = Object.keys(WEAPONS).filter((k) => WEAPONS[k].tier === tier && k !== START_WEAPON);
  const key = shuffle(keys)[0];
  const el = Math.random() < DROP_ELEMENT_CHANCE ? shuffle(Object.keys(ELEMENTS))[0] : null;
  return { key, el, elv: el ? 1 : 0 };
}

const roomCenter = (r) => ({ x: (r.x0 + r.w / 2) * TILE, y: (r.y0 + r.h / 2) * TILE });

// 새 스테이지: 상자방에는 큰 상자, 상점방에는 상품 4개
function setupStageRooms(state) {
  state.shop = [];
  for (const r of state.map.rooms || []) {
    const c = roomCenter(r);
    if (r.type === 'chest') spawnChest(state, c.x, c.y, true);
    if (r.type === 'shop') {
      const items = [
        { kind: 'weapon', ...randomWeaponDrop(state) },
        { kind: 'weapon', ...randomWeaponDrop(state, 2) },
        { kind: 'heal' },
        { kind: Math.random() < 0.5 ? 'mana' : 'card' },
      ];
      items.forEach((it, i) => {
        const price = it.kind === 'weapon' ? SHOP.weapon[WEAPONS[it.key].tier] + (it.el ? SHOP.elementExtra : 0) : SHOP[it.kind].price;
        state.shop.push({ id: state.nextId++, x: c.x + (i - 1.5) * 52, y: c.y + 10, sold: false, price, ...it });
      });
    }
  }
}

function buy(state, p, item) {
  if (item.sold) return;
  if (item.gold) {
    // 캠프 상점 (팀 골드)
    if (state.gold < item.price) { floatText(state, item.x, item.y - 30, `골드가 모자라요 (${item.price})`, '#ffcc80', 1); return; }
    const c = state.castle;
    if (item.kind === 'repair' && c && c.hp >= c.maxHp) { floatText(state, item.x, item.y - 30, '성이 멀쩡해요', '#ffcc80', 1); return; }
    state.gold -= item.price;
    item.sold = true;
    if (item.kind === 'cheal') heal(p, 3);
    else if (item.kind === 'repair' && c) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.3);
    else if (item.kind === 'rally') state.rally = true;
    else if (item.kind === 'volley') state.volley = true;
    else if (item.kind === 'horn') p.sumCd = {};
    floatText(state, item.x, item.y - 30, `${SHOP[item.kind].name}!`, '#ffd54f', 1.2);
    return;
  }
  const price = Math.max(1, Math.round(item.price * (1 - (p.bb?.shop || 0))));
  if (p.coins < price) {
    floatText(state, item.x, item.y - 30, `동전이 모자라요 (${price})`, '#ffcc80', 1);
    return;
  }
  p.coins -= price;
  item.sold = true;
  if (item.kind === 'weapon') state.pickups.push({ id: state.nextId++, x: item.x, y: item.y + 30, key: item.key, el: item.el, elv: item.elv });
  else if (item.kind === 'heal') heal(p, 3);
  else if (item.kind === 'mana') p.mana = Math.min(stats(p).maxMana, p.mana + 60);
  else if (item.kind === 'card') { p.offerQueue++; nextOffer(p); }
  floatText(state, item.x, item.y - 30, '구매!', '#ffd54f', 1);
}

// E 키: 가까운 상자 열기 → 상점 상품 사기 → 가까운 무기 줍기 (칸이 꽉 차면 들고 있는 무기와 바꿈)
function interact(state, p) {
  const chest = nearest(state.chests.filter((c) => !c.open), p.x, p.y, INTERACT_RANGE);
  if (chest && state.mode === 'camp') {
    // 성 지키기 상자: 전리품(로비 보급관에서 쓰는 재화)을 모든 플레이어에게
    chest.open = true;
    const n = chest.elite ? SPOILS.eliteChest : SPOILS.chest;
    for (const q of Object.values(state.players)) q.spoils += n;
    floatText(state, chest.x, chest.y - 18, `전리품 ✪${n} (모두)`, '#ffb74d', 1.4);
    addFx(state, { k: 'r', x: chest.x, y: chest.y, r: 40, c: '#ffb74d', t: 0.4, life: 0.4 });
    return;
  }
  if (chest) {
    chest.open = true;
    const drop = randomWeaponDrop(state, chest.big ? 2 : 1);
    state.pickups.push({ id: state.nextId++, x: chest.x, y: chest.y + 26, ...drop });
    // 상자에서 동전·마나도 쏟아짐
    dropOrbs(state, chest.x, chest.y, 'g', chest.big ? 14 : 6, 30);
    dropOrbs(state, chest.x, chest.y, 'm', 3, 30, 10);
    floatText(state, chest.x, chest.y - 18, '무기 획득!', '#ffd54f', 1);
    // 가끔 모험 보물 (모두에게)
    if (!chest.big && Math.random() < TREASURE_CHEST_CHANCE) for (const q of Object.values(state.players)) giveTreasure(state, q);
    return;
  }
  const item = nearest(state.shop.filter((o) => !o.sold), p.x, p.y, INTERACT_RANGE - 10);
  if (item) { buy(state, p, item); return; }
  const pk = nearest(state.pickups, p.x, p.y, INTERACT_RANGE);
  if (!pk) return;
  state.pickups = state.pickups.filter((o) => o !== pk);
  const slot = newSlot(pk.key, pk.el, pk.elv);
  if (p.weapons.length < weaponSlotsOf(p)) {
    p.weapons.push(slot);
    p.slot = p.weapons.length - 1;
  } else {
    const old = held(p);
    state.pickups.push({ id: state.nextId++, x: p.x, y: p.y + 10, key: old.key, el: old.el, elv: old.elv });
    p.weapons[p.slot] = slot;
    if (p.javelin) p.javelin = null;
  }
  p.hp = Math.min(p.hp, maxHpOf(p));
  p.fireCd = Math.max(p.fireCd, 0.3);
}

function swapWeapon(p) {
  if (p.weapons.length < 2 || p.swapCd > 0 || p.ultT > 0) return;
  p.slot = (p.slot + 1) % p.weapons.length;
  p.swapCd = SWAP_COOLDOWN;
  p.fireCd = Math.max(p.fireCd, 0.3); // 교체만으로 공격 쿨타임을 건너뛰지 못하게
  p.chargeT = 0;
  p.hp = Math.min(p.hp, maxHpOf(p));
}

// ---------- 행동 처리 ----------
function doAction(state, p, inp) {
  const act = inp.act;
  if (state.phase === 'lobby') {
    if (act === 'fence') lobbyInteract(state, p);
    else if (act === 'swap') swapWeapon(p);
    else if (act === 'skill') useSkill(state, p, inp);
    else if (act.startsWith('cast')) castActive(state, p, Number(act[4]) - 1, inp); // 로비에서 스킬 시험
    return;
  }
  if (state.phase === 'transition') {
    if (act.startsWith('reward') && p.reward && !p.rewardDone) {
      const key = p.reward[Number(act[6]) - 1];
      if (key) { applyReward(p, key); p.rewardDone = true; }
    } else if (act.startsWith('evo') && p.evo && !p.evoDone) {
      if (act !== 'evoskip') evolve(p, p.evo[Number(act[3]) - 1]);
      p.evoDone = true;
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
  if (act.startsWith('sum')) { summonUnit(state, p, Number(act[3]) - 1); return; } // 쓰러져 있어도 소환은 가능
  if (!p.alive) return;
  if (act === 'skill') useSkill(state, p, inp);
  else if (act === 'ult') useUlt(state, p, inp);
  else if (act === 'swap') swapWeapon(p);
  else if (act.startsWith('cast')) castActive(state, p, Number(act[4]) - 1, inp);
  else if (state.mode !== 'camp') {
    if (act === 'fence') interact(state, p); // 모험 모드에서 E = 상호작용
  } else if (act === 'fence' || act === 'turret') {
    // 캠프에서도 상자·무기가 가까우면 E는 상호작용
    if (act === 'fence' && (nearest(state.chests.filter((c) => !c.open), p.x, p.y, INTERACT_RANGE) || nearest(state.pickups, p.x, p.y, INTERACT_RANGE) || nearest(state.shop.filter((o) => !o.sold), p.x, p.y, INTERACT_RANGE - 10))) interact(state, p);
    else build(state, p, act, inp.bx, inp.by);
  } else if (act === 'demolish') demolish(state, inp.bx, inp.by);
}

// ---------- 마나 & 치명타 ----------
function spendMana(state, p, cost) {
  if (state.phase === 'lobby') return true; // 로비에서는 마나 무한
  if (cost <= 0 || p.mana >= cost) { p.mana -= Math.max(0, cost); return true; }
  if (p.manaMsgT <= 0) {
    floatText(state, p.x, p.y - 34, '마나 부족', '#64b5f6', 0.7);
    p.manaMsgT = 1;
  }
  return false;
}

function rollCrit(st, sure = false) {
  return sure || Math.random() < st.crit;
}

// ---------- 기본 공격 ----------
function makeBullet(state, p, a, speed, extra) {
  const { el, elv } = attackElement(p);
  return {
    id: state.nextId++, owner: 'p', shooter: p.id, kind: held(p).key, fam: heldFam(p),
    x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    r: 4, dmg: 1, life: 1, pierce: 0, bounce: 0, hits: [], el, elv, ...extra,
  };
}

function releaseCharge(state, p, st) {
  const ch = Math.min(1, p.chargeT / st.W.charge);
  p.chargeT = 0;
  if (ch < 0.08) return; // 너무 짧게 누르면 안 쏨 (흘리지 않게)
  p.fireCd = shoot(state, p, st, ch) ? st.cd * CHARGE.afterCd : 0.25;
}

// ch: 차징 정도 0~1 (활 계열). 없으면 보통 사격
function shoot(state, p, st, ch = null) {
  const W = st.W;
  const chMul = ch === null ? 1 : CHARGE.minDmg + (CHARGE.fullDmg - CHARGE.minDmg) * ch;
  const full = ch !== null && ch >= 1;
  // 마나: 한 번 쏠 때마다 (궁극기 '난사' 중에는 무료)
  if (!(st.fam === 'gun' && p.ultT > 0) && !spendMana(state, p, W.mana || 0)) return false;
  const ae = attackElement(p, true);
  const speed = W.speed * (ae.el === 'wind' ? 1.3 : 1) * (ch === null ? 1 : 0.7 + 0.5 * ch);
  const pellets = W.pellets || 1;
  const total = st.shots * pellets;
  const spread = (W.spread || 0.16);
  const barrels = W.barrels || [0];
  // 한 번에 나가는 총알 묶음(산탄·쌍총열): 피해는 총알마다, 속성 효과(빙결·화상 등)는 적 하나당 한 번만
  const vol = { hit: new Set(), el2: ae.el2, elv2: ae.elv2 };
  const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
  for (const off of barrels) {
    for (let i = 0; i < total; i++) {
      const a = p.angle + (total > 1 ? (i / (total - 1) - 0.5) * spread * Math.max(1, total / 3) : 0) + (Math.random() - 0.5) * st.inacc;
      // 멀티샷으로 늘어난 총알은 피해 50%
      const extra = pellets > 1 ? i >= pellets : i > 0;
      let dmg = st.dmg * chMul * (extra ? 0.5 : 1);
      const crit = rollCrit(st);
      if (crit) dmg *= st.critX;
      const b = makeBullet(state, p, a, speed, {
        r: W.fam === 'bow' ? 5 : 4, dmg, crit, sx: p.x, sy: p.y, falloff: !!W.falloff,
        life: W.life, pierce: st.pierce + (full ? CHARGE.fullPierce : 0), bounce: st.bounce, blast: W.blast || 0, el: ae.el, elv: ae.elv, vol,
      });
      b.x += nx * off;
      b.y += ny * off;
      if (full) b.full = 1;
      state.bullets.push(b);
    }
  }
  if (full) addFx(state, { k: 'r', x: p.x + Math.cos(p.angle) * 18, y: p.y + Math.sin(p.angle) * 18, r: 16, c: '#fff59d', t: 0.2, life: 0.2 });
  return true;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

// 정전기 특성: 대시 직후 첫 공격이 연쇄 번개
function staticChain(state, p, e) {
  if (!hasPerk(p, 'static') || p.staticT <= 0) return;
  p.staticT = 0;
  chainLightning(state, e, 3, 2, p.id);
}

function chainLightning(state, from, count, dmg, src) {
  const hit = new Set([from.id]);
  let cur = from;
  for (let i = 0; i < count; i++) {
    const next = nearest(state.enemies.filter((o) => o.hp > 0 && !hit.has(o.id)), cur.x, cur.y, 160);
    if (!next) break;
    damageEnemy(state, next, dmg, src);
    addFx(state, { k: 'l', x: cur.x, y: cur.y, x2: next.x, y2: next.y, c: '#fff176', t: 0.25, life: 0.25 });
    hit.add(next.id);
    cur = next;
  }
}

// 근접 피해 한 번 (패시브·속성·궁극기 충전 포함)
function meleeHit(state, p, e, dmg, ux, uy, knock, ae = attackElement(p)) {
  const st = stats(p);
  const crit = rollCrit(st);
  damageEnemy(state, e, crit ? dmg * st.critX : dmg, p.id, crit ? 'crit' : '');
  staticChain(state, p, e);
  if (heldFam(p) === 'sword') chargeUlt(p, 'sword', 'stack', 1);
  if (e.hp > 0) {
    const W = WEAPONS[held(p).key];
    if (W.execute && e.kind !== 'boss' && e.hp <= e.maxHp * W.execute) {
      damageEnemy(state, e, e.hp, p.id, 'crit');
      floatText(state, e.x, e.y - e.r - 16, '처형!', '#ef9a9a');
      return;
    }
    push(state, e, ux, uy, knock);
    if (ae.el) applyElement(state, e, { el: ae.el, elv: ae.elv, shooter: p.id, vx: ux, vy: uy });
    if (ae.el2 && e.hp > 0) comboHit(state, e, ae.el2, ae.elv2, p.id, ux, uy);
  }
}

function melee(state, p, st) {
  const W = st.W;
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  const ae = attackElement(p, true);
  const color = ELEMENTS[ae.el]?.color || '#ffffff';
  let dmg = st.dmg;
  if (st.fam === 'sword' && p.parry > 0) { dmg += p.parry * st.mul; p.parry = 0; } // 검 패시브: 반격 자세
  p.swingT = SWING_TIME;
  p.swingDir = -p.swingDir;

  if (W.kind === 'slam') {
    const cx = p.x + ax * W.reach * st.reach, cy = p.y + ay * W.reach * st.reach;
    const rad = W.radius * st.reach;
    addFx(state, { k: 'r', x: cx, y: cy, r: rad, c: color, t: 0.25, life: 0.25 });
    for (const e of state.enemies.filter((o) => o.hp > 0 && (o.x - cx) ** 2 + (o.y - cy) ** 2 <= (rad + o.r) ** 2)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      meleeHit(state, p, e, dmg, (e.x - p.x) / d, (e.y - p.y) / d, W.knock, ae);
    }
    for (const b of state.barrels) if (b.hp > 0 && Math.hypot(b.x - cx, b.y - cy) < rad + 12) hitBarrel(state, b, 1, p.id);
    if (W.quake) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        state.bullets.push({ ...makeBullet(state, p, a, 300, { kind: 'wave', dmg: dmg / 2, life: 0.45, pierce: 3, r: 6 }), x: cx, y: cy });
      }
    }
    return;
  }

  const range = W.range * st.reach;
  // 휘두르기 이펙트: 검 계열은 초승달 베기, 창 계열은 찌르기 섬광 (할버드는 둘 다)
  if (st.fam === 'sword' || ['halberd', 'trident'].includes(held(p).key)) {
    addFx(state, { k: 'sw', x: p.x, y: p.y, a: p.angle, r: range, s: W.arc, d: p.swingDir, c: color, t: SWING_TIME, life: SWING_TIME });
  }
  if (st.fam === 'spear') {
    addFx(state, { k: 'th', x: p.x, y: p.y, a: p.angle, r: range, c: color, t: 0.16, life: 0.16 });
  }
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > range + e.r || angleDiff(Math.atan2(e.y - p.y, e.x - p.x), p.angle) > W.arc / 2 + e.r / Math.max(d, 1)) continue;
    // 창 패시브: 창끝 일격
    const tip = st.fam === 'spear' && d > range * 0.6;
    meleeHit(state, p, e, tip ? dmg * 1.5 : dmg, (e.x - p.x) / (d || 1), (e.y - p.y) / (d || 1), W.knock, ae);
  }
  // 근접 공격으로 폭발 통도 터뜨림
  for (const b of state.barrels) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (b.hp > 0 && d < range + 12 && angleDiff(Math.atan2(b.y - p.y, b.x - p.x), p.angle) < W.arc / 2 + 0.3) hitBarrel(state, b, 1, p.id);
  }
  // 검 계열: 적 총알을 베어 없앰 (대검은 범위 2배)
  if (st.fam === 'sword') {
    const pr = range * (W.parry || 1) + 6;
    for (const b of state.bullets) {
      if (b.owner !== 'e' || b.dead) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= pr && angleDiff(Math.atan2(b.y - p.y, b.x - p.x), p.angle) <= W.arc / 2 + 0.3) {
        b.dead = true;
        p.parry = Math.min(3, p.parry + 1);
      }
    }
  }
}

// ---------- 무기 기본 스킬 (우클릭) ----------
function useSkill(state, p, inp) {
  const s = held(p);
  const fam = weaponFam(s.key);
  // 창: 던진 창이 있으면 다시 누를 때 회수 (충전 소모 없음)
  if (fam === 'spear' && p.javelin) {
    const jv = state.bullets.find((b) => b.id === p.javelin);
    if (jv) { jv.returning = true; jv.stuck = false; jv.hits = []; jv.life = 3; }
    else p.javelin = null;
    return;
  }
  if (s.charges <= 0 || !spendMana(state, p, MANA.weaponSkill)) return;
  s.charges--;
  if (s.cd <= 0) s.cd = skillCdOf(s.key);
  const st = stats(p);
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  if (fam === 'sword') {
    p.sdash = { t: 0.22, ux: ax, uy: ay, hits: [] };
    p.invuln = Math.max(p.invuln, 0.3);
  } else if (fam === 'spear') {
    const jv = makeBullet(state, p, p.angle, 720, { kind: 'javelin', dmg: st.dmg * 2, life: 8, pierce: 99, r: 6 });
    state.bullets.push(jv);
    p.javelin = jv.id;
  } else if (fam === 'hammer') {
    addFx(state, { k: 'r', x: p.x, y: p.y, r: 110, c: '#ffcc80', t: 0.4, life: 0.4 });
    for (const e of enemiesNear(state, p.x, p.y, 110)) {
      e.st.stun = Math.max(e.st.stun, 1);
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      meleeHit(state, p, e, st.dmg * 1.5, (e.x - p.x) / d, (e.y - p.y) / d, 20);
    }
  } else if (fam === 'bow') {
    p.dashT = 0.15;
    p.dashX = -ax;
    p.dashY = -ay;
    p.invuln = Math.max(p.invuln, 0.2);
    for (let i = 0; i < 5; i++) {
      const a = p.angle + (i / 4 - 0.5) * 0.6;
      state.bullets.push(makeBullet(state, p, a, 760, { r: 5, dmg: st.dmg, life: 0.8, pierce: 1 }));
    }
  } else if (fam === 'gun') {
    const t = aimPoint(p, inp, 260);
    const { el, elv } = attackElement(p);
    state.grenades.push({ id: state.nextId++, kind: 'grenade', sx: p.x, sy: p.y, tx: t.x, ty: t.y, t: 0, dur: 0.8, src: p.id, dmg: 5 * st.mul, r: 80, el, elv });
  }
}

// ---------- 스킬 트리 액티브 스킬 (1~3) ----------
function castActive(state, p, idx, inp) {
  const id = p.loadout[idx];
  const node = NODE[id];
  if (!node || node.kind !== 'active' || p.casts[idx] > 0) return;
  const def = ACTIVES[node.skill];
  if (!spendMana(state, p, activeManaCost(def.cd))) return;
  p.casts[idx] = def.cd * p.bonus.cdMul;
  const el = def.el;
  const lv = Math.max(1, p.element === el ? p.elementLv : 1);
  const power = stats(p).mul * (p.char === 'mage' ? 1.4 : 1); // 스킬 피해 = 기본 수치 × 피해 배율 (마법사 +40%)
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  const elOpt = { el, elv: lv };
  floatText(state, p.x, p.y - 34, def.name, ELEMENTS[el].color, 0.8);

  switch (node.skill) {
    case 'fireball':
      state.bullets.push(makeBullet(state, p, p.angle, 520, { ...elOpt, kind: 'fireball', r: 9, dmg: 4 * power, life: 1.4, blast: 64, blastWall: true }));
      break;
    case 'meteor': {
      const t = aimPoint(p, inp, 340);
      state.grenades.push({ id: state.nextId++, kind: 'meteor', sx: t.x - 120, sy: t.y - 260, tx: t.x, ty: t.y, t: 0, dur: 1.0, src: p.id, dmg: 12 * power, r: 115, ...elOpt });
      break;
    }
    case 'wave':
      coneHit(state, p, 150, 1.8, 3 * power, 60, elOpt, '#42a5f5');
      break;
    case 'whirlpool': {
      const t = aimPoint(p, inp, 300);
      state.zones.push({ id: state.nextId++, kind: 'whirl', x: t.x, y: t.y, r: 120, t: 3, tick: 0, every: 0.5, src: p.id, dmg: 1 * power, pull: 70, ...elOpt });
      break;
    }
    case 'bolt': {
      const t = aimPoint(p, inp, 380);
      const target = nearest(state.enemies.filter((e) => e.hp > 0), t.x, t.y, 110);
      const x = target ? target.x : t.x, y = target ? target.y : t.y;
      addFx(state, { k: 'l', x, y: y - 220, x2: x, y2: y, c: '#fff176', t: 0.3, life: 0.3 });
      addFx(state, { k: 'r', x, y, r: 40, c: '#fff176', t: 0.25, life: 0.25 });
      if (target) { damageEnemy(state, target, 6 * power, p.id); if (target.hp > 0) applyElement(state, target, { ...elOpt, shooter: p.id, vx: 0, vy: 1 }); }
      break;
    }
    case 'storm':
      state.zones.push({ id: state.nextId++, kind: 'storm', follow: p.id, x: p.x, y: p.y, r: 230, t: 3, tick: 0, every: 0.3, src: p.id, dmg: 3 * power, ...elOpt });
      break;
    case 'icespike':
      state.bullets.push(makeBullet(state, p, p.angle, 700, { ...elOpt, kind: 'icespike', r: 6, dmg: 4 * power, life: 1, pierce: 2 }));
      break;
    case 'blizzard':
      for (let i = 0; i < 5; i++) {
        const a = p.angle + (i / 4 - 0.5) * 0.55;
        state.bullets.push(makeBullet(state, p, a, 720, { ...elOpt, kind: 'icelance', r: 8, dmg: 5 * power, life: 1.1, pierce: 99, freeze: 1.4 }));
      }
      break;
    case 'gust':
      coneHit(state, p, 170, 2.1, 2 * power, 110, elOpt, '#dcedc8');
      break;
    case 'tornado':
      state.zones.push({ id: state.nextId++, kind: 'tornado', x: p.x + ax * 30, y: p.y + ay * 30, vx: ax * 160, vy: ay * 160, r: 72, t: 3, tick: 0, every: 0.3, src: p.id, dmg: 1.5 * power, pull: 140, ...elOpt });
      break;
    case 'cloud': {
      const t = aimPoint(p, inp, 300);
      state.zones.push({ id: state.nextId++, kind: 'cloud', x: t.x, y: t.y, r: 95, t: 4, tick: 0, every: 0.5, src: p.id, dmg: 0, ...elOpt });
      break;
    }
    case 'plague':
      addFx(state, { k: 'r', x: p.x, y: p.y, r: 260, c: '#9ccc65', t: 0.5, life: 0.5 });
      for (const e of enemiesNear(state, p.x, p.y, 260)) {
        for (let i = 0; i < 3; i++) applyElement(state, e, { ...elOpt, shooter: p.id, vx: 0, vy: 1 });
        e.st.poison = Math.max(e.st.poison, 6);
      }
      break;
    default:
  }
}

// 앞쪽 부채꼴 범위 공격 (물결, 돌풍)
function coneHit(state, p, range, arc, dmg, knock, elOpt, color) {
  addFx(state, { k: 'cone', x: p.x, y: p.y, a: p.angle, r: range, s: arc, c: color, t: 0.3, life: 0.3 });
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > range + e.r || angleDiff(Math.atan2(e.y - p.y, e.x - p.x), p.angle) > arc / 2) continue;
    const ux = (e.x - p.x) / (d || 1), uy = (e.y - p.y) / (d || 1);
    damageEnemy(state, e, dmg, p.id);
    if (e.hp > 0) {
      push(state, e, ux, uy, knock);
      applyElement(state, e, { ...elOpt, shooter: p.id, vx: ux, vy: uy });
    }
  }
}

// ---------- 궁극기 (Q) ----------
function useUlt(state, p, inp) {
  const s = held(p);
  const fam = weaponFam(s.key);
  const def = SKILLS[fam].ult;
  if (s.ult < def.need || p.ultT > 0) return;
  s.ult = 0;
  p.ultFam = fam;
  p.ultTick = 0;
  p.ultStep = 0;
  floatText(state, p.x, p.y - 34, def.name, '#ffd54f', 1.2);
  if (fam === 'sword') p.ultT = 3;
  else if (fam === 'spear') p.ultT = 2;
  else if (fam === 'hammer') p.ultT = 1.1;
  else if (fam === 'gun') p.ultT = 5;
  else if (fam === 'bow') {
    const { el, elv } = attackElement(p);
    state.zones.push({ id: state.nextId++, kind: 'rain', x: inp.bx, y: inp.by, r: 100, t: 3, tick: 0, every: 0.3, src: p.id, dmg: stats(p).dmg, el, elv, elChance: 0.3 });
  }
}

function updateUlt(state, p, st, dt) {
  if (p.ultT <= 0) return;
  p.ultT -= dt;
  p.ultTick -= dt;
  const fam = p.ultFam;
  if (fam === 'sword' && p.ultTick <= 0) {
    p.ultTick = 0.25;
    addFx(state, { k: 'sw', x: p.x, y: p.y, a: p.ultT * 9, r: 70, s: Math.PI * 1.6, d: 1, c: '#e0f7fa', t: 0.22, life: 0.22 });
    for (const e of enemiesNear(state, p.x, p.y, 70)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      damageEnemy(state, e, st.dmg, p.id);
      if (e.hp > 0) push(state, e, (e.x - p.x) / d, (e.y - p.y) / d, 8);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + p.ultT;
      state.bullets.push(makeBullet(state, p, a, 420, { kind: 'wave', dmg: st.dmg, life: 0.45, pierce: 2, r: 6 }));
    }
  } else if (fam === 'spear' && p.ultTick <= 0) {
    p.ultTick = 0.1;
    const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
    addFx(state, { k: 'th', x: p.x, y: p.y, a: p.angle + (Math.random() - 0.5) * 0.12, r: 230, c: '#fff9c4', t: 0.12, life: 0.12 });
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      const rx = e.x - p.x, ry = e.y - p.y;
      const along = rx * ax + ry * ay, side = Math.abs(rx * ay - ry * ax);
      if (along > 0 && along < 230 + e.r && side < 26 + e.r) {
        damageEnemy(state, e, st.dmg, p.id);
        if (e.hp > 0) push(state, e, ax, ay, 6);
      }
    }
  } else if (fam === 'hammer') {
    const at = [1.1, 0.6, 0.1]; // 남은 시간 기준 세 번
    while (p.ultStep < 3 && p.ultT <= at[p.ultStep]) {
      const rad = [90, 130, 180][p.ultStep];
      addFx(state, { k: 'r', x: p.x, y: p.y, r: rad, c: '#ffab40', t: 0.35, life: 0.35 });
      for (const e of enemiesNear(state, p.x, p.y, rad)) {
        const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        e.st.stun = Math.max(e.st.stun, 0.5);
        damageEnemy(state, e, st.dmg * 2, p.id);
        if (e.hp > 0) push(state, e, (e.x - p.x) / d, (e.y - p.y) / d, 24);
      }
      p.ultStep++;
    }
  }
  if (p.ultT <= 0) p.ultT = 0;
}

function updatePlayer(state, p, inp, dt) {
  p.paused = inp.pz;
  if (inp.seq !== p.lastSeq) {
    p.lastSeq = inp.seq;
    if (inp.act) doAction(state, p, inp);
  }
  const lobby = state.phase === 'lobby';
  if (state.phase !== 'playing' && !lobby) return;

  p.fireCd = Math.max(0, p.fireCd - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.dashT = Math.max(0, p.dashT - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.swapCd = Math.max(0, p.swapCd - dt);
  p.staticT = Math.max(0, p.staticT - dt);
  p.swingT = Math.max(0, p.swingT - dt);
  p.manaMsgT = Math.max(0, p.manaMsgT - dt);
  p.shieldT = Math.max(0, p.shieldT - dt);
  // 스킬 쿨타임·시간형 궁극기는 전투 중에만 충전 (로비에서는 시험용으로 항상)
  const combat = lobby || inCombat(state);
  const cdt = combat ? dt : 0;
  for (let i = 0; i < p.casts.length; i++) p.casts[i] = Math.max(0, p.casts[i] - cdt);
  // 모든 무기 칸의 스킬 쿨타임은 들고 있지 않아도 충전
  for (const s of p.weapons) {
    const maxC = WEAPONS[s.key].charges || 1;
    if (s.charges < maxC) {
      s.cd -= cdt;
      if (s.cd <= 0) {
        s.charges++;
        s.cd = s.charges < maxC ? skillCdOf(s.key) : 0;
      }
    }
    const ult = SKILLS[weaponFam(s.key)].ult;
    if (!lobby && combat && ult.type === 'time' && !(p.ultT > 0 && s === held(p))) {
      s.ult = Math.min(ult.need, s.ult + dt * (s.el && s.el === p.element ? RESONANCE.ult : 1) * p.bonus.ultMul);
    }
  }
  if (!p.alive) { p.moving = false; return; }
  const st = stats(p);
  // 마나는 저절로 차지 않음 (파란 구슬을 주워야 함). 로비에서는 가득.
  if (lobby) p.mana = st.maxMana;
  else p.mana = Math.min(st.maxMana, p.mana);

  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }
  p.moving = len > 0 || p.dashT > 0 || !!p.sdash;

  if (inp.dash && p.dashCd <= 0 && len > 0 && !p.sdash) {
    p.dashT = DASH_TIME;
    p.dashCd = st.dashCd;
    p.dsx = p.x; // 잔상은 대시하기 전 자리에
    p.dsy = p.y;
    p.dashX = mx;
    p.dashY = my;
    p.dashHits = [];
    p.invuln = Math.max(p.invuln, DASH_TIME + 0.05);
    if (hasPerk(p, 'static')) p.staticT = 1.5;
  }
  if (p.sdash) {
    // 검 스킬: 돌진 베기
    const sd = p.sdash;
    sd.t -= dt;
    moveCircle(state, p, sd.ux * 600 * dt, sd.uy * 600 * dt, false);
    for (const e of state.enemies) {
      if (e.hp <= 0 || sd.hits.includes(e.id)) continue;
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r + 10) {
        sd.hits.push(e.id);
        meleeHit(state, p, e, st.dmg * 2, sd.ux, sd.uy, 16);
      }
    }
    addFx(state, { k: 'r', x: p.x, y: p.y, r: 14, c: '#e0f7fa', t: 0.12, life: 0.12 });
    if (sd.t <= 0) p.sdash = null;
  } else if (p.dashT > 0) {
    moveCircle(state, p, p.dashX * DASH_SPEED * dt, p.dashY * DASH_SPEED * dt, false);
    // 랜스: 대시로 부딪힌 적에게 피해
    const W = st.W;
    if (W.dashHit) {
      for (const e of state.enemies) {
        if (e.hp <= 0 || p.dashHits.includes(e.id)) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r + 6) {
          p.dashHits.push(e.id);
          meleeHit(state, p, e, W.dashHit + st.dmg - W.dmg, p.dashX, p.dashY, 20);
        }
      }
    }
  } else {
    const cs = p.chargeT > 0 ? CHARGE.moveSlow : 1; // 활시위를 당기는 동안 조금 느리게
    moveCircle(state, p, mx * st.speed * cs * dt, my * st.speed * cs * dt, false);
  }

  p.angle = inp.aim;

  // 총 패시브: 연발 가속
  if (st.fam === 'gun') {
    if (inp.fire) { p.spin = Math.min(0.4, p.spin + dt * 0.25); p.spinIdle = 0; }
    else { p.spinIdle += dt; if (p.spinIdle > 1) p.spin = 0; }
  }

  if (st.W.charge) {
    // 활: 누르고 있으면 차징, 떼는 순간에만 발사 (누르고 있으면 쏘지 않음)
    const busy = p.dashT > 0 || p.sdash;
    if (inp.fire && p.fireCd <= 0 && !busy) {
      p.chargeT = Math.min(p.chargeT + dt, st.W.charge);
    } else if (!inp.fire && p.chargeT > 0) {
      releaseCharge(state, p, st);
    } else if (busy) p.chargeT = 0;
  } else if (inp.fire && p.fireCd <= 0 && p.dashT <= 0 && !p.sdash) {
    p.chargeT = 0;
    if (st.W.kind === 'ranged') p.fireCd = shoot(state, p, st) ? st.cd : 0.25;
    else { p.fireCd = st.cd; melee(state, p, st); }
  }

  if (lobby) return;
  updateUlt(state, p, st, dt);

  // 구슬(경험치 초록·마나 파랑·동전 노랑): 플레이어마다 따로 줍습니다 (1P가 먹어도 2P 몫은 남아 있음)
  for (const o of state.orbs) {
    if (o.taken.includes(p.id)) continue;
    if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < ORB_RANGE * ORB_RANGE) {
      o.taken.push(p.id);
      if (o.k === 'h') heal(p, 1);
      else if (o.k === 'm') p.mana = Math.min(st.maxMana, p.mana + o.v * st.manaGain);
      else if (o.k === 'g') p.coins += o.v * p.bonus.coinMul;
      else gainXp(p, o.v);
    }
  }

  // 베이스캠프: 캠프 안에 있으면 체력이 천천히 회복 (준비 시간에는 빠르게)
  const camp = state.map.camp;
  if (camp && Math.hypot(p.x - camp.x, p.y - camp.y) <= camp.r && p.hp < maxHpOf(p)) {
    p.healT += dt;
    if (p.healT >= (state.campPhase === 'fight' ? CAMP_HEAL_EVERY : 0.5)) { p.healT = 0; heal(p, 1); }
  } else {
    p.healT = 0;
  }
}

// ---------- 속성 & 원소 반응 ----------
// tag: 'crit' 치명타, 'dot' 지속 피해 (피해 숫자 색이 달라짐)
function damageEnemy(state, e, dmg, src, tag = '') {
  if (e.hp <= 0 || !(dmg > 0)) return;
  const real = Math.min(e.hp, dmg);
  e.hp -= dmg;
  e.hitT = 0.08;
  if (state.fx.length < 220) {
    state.fx.push({ k: 'dn', x: e.x + (Math.random() - 0.5) * e.r, y: e.y - e.r, v: Math.round(dmg * 10) / 10, g: tag, t: 0.7, life: 0.7 });
  }
  if (!src) return;
  e.lastHit = src;
  const p = state.players[src];
  if (p) {
    chargeUlt(p, 'spear', 'gauge', real);
    chargeUlt(p, 'hammer', 'gauge', real);
  }
}

function enemiesNear(state, x, y, radius) {
  return state.enemies.filter((o) => o.hp > 0 && (o.x - x) ** 2 + (o.y - y) ** 2 <= radius * radius);
}

function newStatus() {
  return {
    burn: 0, burnTick: 0, burnBy: null, wet: 0, chill: 0, chillN: 0, frozen: 0, fImm: 0,
    poison: 0, poisonN: 0, poisonTick: 0, poisonBy: null, stun: 0,
  };
}

// 원소 반응 글자 + 연금술사 패시브(촉매: 반응하면 마나 +3)
function reactText(state, e, text, color, src) {
  floatText(state, e.x, e.y - e.r - 6, text, color);
  const p = state.players[src];
  if (p?.char === 'alchemist' && p.alive) p.mana = Math.min(stats(p).maxMana, p.mana + 3);
}
// 반응 피해 (연금술사 +60%)
const reactDmg = (state, src, n) => n * (state.players[src]?.char === 'alchemist' ? 1.6 : 1);

// 결합 효과: 무기 속성과 다른 캐릭터 속성이 함께 들어감
function comboHit(state, e, el, elv, src, vx, vy) {
  applyElement(state, e, { el, elv, shooter: src, vx, vy });
  addFx(state, { k: 'r', x: e.x, y: e.y, r: e.r + 8, c: ELEMENTS[el].color, t: 0.2, life: 0.2 });
}


function explode(state, e, lv, src) {
  reactText(state, e, '폭발!', '#ffab40', src);
  addFx(state, { k: 'r', x: e.x, y: e.y, r: 80, c: '#ffab40', t: 0.35, life: 0.35 });
  for (const o of enemiesNear(state, e.x, e.y, 80)) damageEnemy(state, o, reactDmg(state, src, 1 + lv), src);
}

function applyElement(state, e, b) {
  const s = e.st, lv = b.elv || 1, src = b.shooter;
  switch (b.el) {
    case 'fire':
      if (s.frozen > 0 || s.chill > 0) {
        reactText(state, e, '녹임!', '#ff8a65', src);
        Object.assign(s, { frozen: 0, chill: 0, chillN: 0 });
        damageEnemy(state, e, reactDmg(state, src, 2 + lv), src);
      } else if (s.poison > 0) {
        Object.assign(s, { poison: 0, poisonN: 0 });
        explode(state, e, lv, src);
      } else if (s.wet > 0) {
        reactText(state, e, '증발!', '#e0e0e0', src);
        s.wet = 0;
        damageEnemy(state, e, reactDmg(state, src, 1 + lv), src);
      } else {
        s.burn = Math.max(s.burn, 1.5 + lv * 0.5);
        s.burnBy = src;
      }
      break;
    case 'water':
      if (s.burn > 0) {
        reactText(state, e, '증발!', '#e0e0e0', src);
        s.burn = 0;
        damageEnemy(state, e, reactDmg(state, src, 1 + lv), src);
      }
      s.wet = Math.max(s.wet, 2.5 + lv);
      break;
    case 'electric':
      if (s.wet > 0) {
        reactText(state, e, '감전!', '#fff176', src);
        for (const o of enemiesNear(state, e.x, e.y, 130)) {
          if (o.st.wet <= 0) continue;
          damageEnemy(state, o, reactDmg(state, src, 1 + lv), src);
          o.st.stun = 0.6;
          o.st.wet = 0;
          if (o !== e) addFx(state, { k: 'l', x: e.x, y: e.y, x2: o.x, y2: o.y, c: '#fff176', t: 0.25, life: 0.25 });
        }
      } else {
        chainLightning(state, e, lv, 1, src);
      }
      break;
    case 'ice':
      if (s.burn > 0) {
        reactText(state, e, '녹임!', '#ff8a65', src);
        s.burn = 0;
        damageEnemy(state, e, reactDmg(state, src, 2 + lv), src);
      } else if (s.frozen > 0 || s.fImm > 0) {
        s.chill = 2; // 얼어 있거나 막 풀린 적은 다시 얼지 않음 (무한 빙결 방지)
      } else if (s.wet > 0) {
        reactText(state, e, '빙결!', '#b2ebf2', src);
        s.wet = 0;
        s.frozen = 1 + 0.5 * lv;
        s.fImm = s.frozen + 1.5;
      } else {
        s.chill = 2;
        s.chillN++;
        if (s.chillN >= 3) {
          reactText(state, e, '빙결!', '#b2ebf2', src);
          Object.assign(s, { frozen: 0.8 + 0.3 * lv, chill: 0, chillN: 0 });
          s.fImm = s.frozen + 1.5;
        }
      }
      break;
    case 'wind': {
      const len = Math.hypot(b.vx, b.vy) || 1;
      push(state, e, b.vx / len, b.vy / len, 30 + 12 * lv);
      if (s.burn > 0 || s.poison > 0 || s.wet > 0 || s.chill > 0) {
        const others = enemiesNear(state, e.x, e.y, 90 + 20 * lv).filter((o) => o !== e);
        if (others.length) reactText(state, e, '확산!', '#dcedc8', src);
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
        const cap = 2 + lv + (hasPerk(state.players[src], 'venom') ? 2 : 0);
        s.poison = Math.max(s.poison, 4);
        s.poisonN = Math.min(cap, s.poisonN + 1);
        s.poisonBy = src;
      }
      break;
    default:
  }
}

// 상태이상 시간 감소와 지속 피해. 움직일 수 없으면 false를 돌려줍니다.
function updateStatus(state, e, dt) {
  const s = e.st;
  const cc = e.kind === 'boss' ? 3 : 1; // 보스는 빙결·기절이 3배 빨리 풀림
  s.wet = Math.max(0, s.wet - dt);
  s.chill = Math.max(0, s.chill - dt);
  if (s.chill <= 0) s.chillN = 0;
  s.frozen = Math.max(0, s.frozen - dt * cc);
  s.stun = Math.max(0, s.stun - dt * cc);
  s.fImm = Math.max(0, s.fImm - dt);
  if (s.burn > 0) {
    s.burn -= dt;
    s.burnTick -= dt;
    if (s.burnTick <= 0) { s.burnTick = 0.5; damageEnemy(state, e, 1, s.burnBy, 'dot'); }
  }
  if (s.poison > 0) {
    s.poison -= dt;
    s.poisonTick -= dt;
    if (s.poisonTick <= 0) { s.poisonTick = 1; damageEnemy(state, e, s.poisonN, s.poisonBy, 'dot'); }
  } else {
    s.poisonN = 0;
  }
  return s.frozen <= 0 && s.stun <= 0;
}

// ---------- 적 ----------
// lvl: 강함 단계 (모험 = 스테이지 번호, 캠프 = 웨이브 기준)
function makeEnemy(state, kind, x, y, lvl) {
  const T = ENEMY_TYPES[kind];
  const sc = enemyScale(lvl);
  const hp = Math.round(T.hp * sc.hp * 10) / 10;
  return {
    id: state.nextId++, kind, x, y, r: T.r, hp, maxHp: hp, sc,
    cd: 1 + Math.random(), hitT: 0, strafe: Math.random() < 0.5 ? 1 : -1,
    st: newStatus(), lastHit: null, t: Math.random() * 10, face: 0, mode: 0, modeT: 0.5 + Math.random(), fuse: 0,
  };
}

// 나오는 몬스터: 스테이지가 오를수록 종류가 늘어납니다 (ENEMY_TYPES의 from)
const KIND_WEIGHT = { slime: 3, bat: 2.2, archer: 2, spider: 2, bomber: 1.4, brute: 1.1, bigslime: 1.1, caster: 1, shield: 1, totem: 0.6 };
function pickKind(level) {
  const pool = Object.keys(KIND_WEIGHT).filter((k) => ENEMY_TYPES[k].from <= level);
  let r = Math.random() * pool.reduce((a, k) => a + KIND_WEIGHT[k], 0);
  for (const k of pool) { r -= KIND_WEIGHT[k]; if (r <= 0) return k; }
  return 'slime';
}

function enemyBullet(state, e, a, speed, extra = {}) {
  const sc = e.sc || enemyScale(0);
  state.bullets.push({
    id: state.nextId++, owner: 'e', shooter: e.id, x: e.x, y: e.y,
    vx: Math.cos(a) * speed * sc.shot, vy: Math.sin(a) * speed * sc.shot,
    r: 5, dmg: sc.dmg, life: 2.5, pierce: 0, bounce: 0, hits: [], ...extra,
  });
}

// 바닥 위험 지역 (보스): 빨간 경고 원/선이 먼저 보이고, warn초 뒤에 피해
function addHazard(state, h) {
  if (state.hazards.length < 60) state.hazards.push({ id: state.nextId++, t: 0, fired: false, linger: 0, tick: 0, ...h });
}

function ring(state, e, x, y, n, speed, off = 0, gap = 0, extra = {}) {
  const g0 = Math.floor(Math.random() * n);
  for (let i = 0; i < n; i++) {
    if (gap && ((i - g0 + n) % n) < gap) continue; // 빈틈 (피할 수 있는 길)
    enemyBullet(state, { ...e, x, y }, (i / n) * Math.PI * 2 + off, speed, extra);
  }
}

function playersInCircle(state, x, y, r) {
  return Object.values(state.players).filter((p) => p.alive && (p.x - x) ** 2 + (p.y - y) ** 2 < (r + p.r) ** 2);
}

function updateHazards(state, dt) {
  for (const h of state.hazards) {
    h.t += dt;
    const src = state.enemies.find((o) => o.id === h.src) || { id: h.src, x: h.x, y: h.y, sc: h.sc };
    if (h.k === 'circle') {
      if (!h.fired && h.t >= h.warn) {
        h.fired = true;
        addFx(state, { k: 'r', x: h.x, y: h.y, r: h.r, c: h.c || '#ff7043', t: 0.3, life: 0.3 });
        for (const p of playersInCircle(state, h.x, h.y, h.r)) damagePlayer(state, p, h.dmg);
        if (h.after === 'shards') ring(state, src, h.x, h.y, 6, 170, Math.random(), 0, { r: 5 });
        if (h.after === 'ring') ring(state, src, h.x, h.y, 12, 190, Math.random());
      }
      if (h.fired && h.linger > 0) {
        h.tick -= dt;
        if (h.tick <= 0) { h.tick = 0.5; for (const p of playersInCircle(state, h.x, h.y, h.r * 0.9)) damagePlayer(state, p, h.dmg); }
      }
      if (h.t >= h.warn + h.linger + 0.05) h.dead = true;
    } else if (h.k === 'laser') {
      const boss = state.enemies.find((o) => o.id === h.src);
      if (!boss) { h.dead = true; continue; }
      h.x = boss.x; h.y = boss.y;
      if (h.t >= h.warn) {
        h.a += h.spin * dt;
        const ux = Math.cos(h.a), uy = Math.sin(h.a);
        for (const p of Object.values(state.players)) {
          if (!p.alive) continue;
          const rx = p.x - h.x, ry = p.y - h.y;
          const along = rx * ux + ry * uy, side = Math.abs(rx * uy - ry * ux);
          if (along > 0 && along < h.len && side < h.w / 2 + p.r) damagePlayer(state, p, h.dmg);
        }
      }
      if (h.t >= h.warn + h.dur) h.dead = true;
    } else if (h.t >= h.warn) h.dead = true; // 'line': 돌진 예고선
  }
  state.hazards = state.hazards.filter((h) => !h.dead);
}

// 플레이어 쪽으로 천천히 꺾이는 탄 (해골 마법사, 보스)
function steerBullet(state, b, dt) {
  b.home -= dt;
  const t = nearest(Object.values(state.players).filter((p) => p.alive), b.x, b.y, 600);
  if (!t) return;
  const sp = Math.hypot(b.vx, b.vy);
  let a = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(t.y - b.y, t.x - b.x);
  let d = want - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  a += Math.max(-2.2 * dt, Math.min(2.2 * dt, d));
  b.vx = Math.cos(a) * sp;
  b.vy = Math.sin(a) * sp;
}

// ---------- 보스 ----------
function spawnBoss(state, room) {
  const world = Math.min(BOSSES.length - 1, Math.floor(state.stageIdx / STAGES_PER_WORLD));
  const def = BOSSES[world];
  const n = Object.keys(state.players).length;
  const hp = Math.round(def.hp * (1 + 0.6 * (n - 1)));
  const cx = (room.x0 + room.w / 2) * TILE, cy = (room.y0 + 3.5) * TILE;
  const boss = {
    ...makeEnemy(state, 'boss', cx, cy, state.stageIdx), hp, maxHp: hp, world, name: def.name, color: def.color,
    pats: def.patterns, last: null, patT: 2, act: null, actT: 0, spin: 0, sched: [], room,
  };
  state.enemies.push(boss);
  floatText(state, cx, cy - 60, def.name, '#ff8a80', 2);
}

const SUMMON_KIND = [['slime', 'bat'], ['archer', 'spider', 'bat'], ['brute', 'bomber', 'caster']];

// 시간차로 쏘는 탄 예약 (e.sched)
function later(e, at, fn) { e.sched.push({ at, fn }); }

function randomRoomSpot(state, room, awayFrom, minD) {
  for (let i = 0; i < 40; i++) {
    const tx = room.x0 + 2 + Math.floor(Math.random() * (room.w - 4));
    const ty = room.y0 + 2 + Math.floor(Math.random() * (room.h - 4));
    if (isWallTile(state, tx, ty)) continue;
    const x = tileCenter(tx), y = tileCenter(ty);
    if (!awayFrom || Math.hypot(x - awayFrom.x, y - awayFrom.y) >= minD) return { x, y };
  }
  return { x: (room.x0 + room.w / 2) * TILE, y: (room.y0 + room.h / 2) * TILE };
}

function bossPattern(state, e, pat, target, half) {
  const angle = Math.atan2(target.y - e.y, target.x - e.x);
  const dmg = e.sc.dmg;
  const more = half ? 1.4 : 1;
  switch (pat) {
    case 'jump': {
      const spot = freeSpotNear(state, target.x, target.y);
      e.act = 'jump'; e.actT = 0.9; e.jx = e.x; e.jy = e.y; e.tx = spot.x; e.ty = spot.y;
      addHazard(state, { k: 'circle', x: spot.x, y: spot.y, r: 95, warn: 0.9, dmg: dmg + 1, src: e.id, after: 'ring' });
      break;
    }
    case 'ring':
      for (let i = 0; i < (half ? 3 : 2); i++) later(e, i * 0.35, () => ring(state, e, e.x, e.y, Math.round(16 * more), 200, i * 0.2, 0, { r: 6 }));
      break;
    case 'fan':
      for (let w = 0; w < 5; w++) {
        later(e, w * 0.16, () => {
          const a0 = Math.atan2(target.y - e.y, target.x - e.x) + (w - 2) * 0.12;
          for (let i = -3; i <= 3; i++) enemyBullet(state, e, a0 + i * 0.16, 240);
        });
      }
      break;
    case 'summon': {
      const minions = state.enemies.filter((o) => o.kind !== 'boss').length;
      const pool = SUMMON_KIND[e.world] || SUMMON_KIND[0];
      for (let i = 0; i < Math.max(0, (half ? 5 : 3) - minions); i++) {
        const a = Math.random() * Math.PI * 2;
        const spot = freeSpotNear(state, e.x + Math.cos(a) * 80, e.y + Math.sin(a) * 80);
        state.enemies.push(makeEnemy(state, pool[i % pool.length], spot.x, spot.y, state.stageIdx));
        addFx(state, { k: 'r', x: spot.x, y: spot.y, r: 18, c: '#ef5350', t: 0.3, life: 0.3 });
      }
      break;
    }
    case 'puddle': {
      const alive = Object.values(state.players).filter((p) => p.alive);
      for (let i = 0; i < (half ? 6 : 4); i++) {
        const t = alive[i % alive.length];
        const x = t.x + (i < alive.length ? 0 : (Math.random() - 0.5) * 260), y = t.y + (i < alive.length ? 0 : (Math.random() - 0.5) * 260);
        addHazard(state, { k: 'circle', x, y, r: 52, warn: 0.8, linger: 3.5, dmg, src: e.id, c: e.color });
      }
      break;
    }
    case 'bounce':
      for (let i = 0; i < (half ? 12 : 8); i++) enemyBullet(state, e, angle + (i / (half ? 12 : 8)) * Math.PI * 2, 230, { bounce: 3, life: 4.5, r: 7 });
      break;
    case 'volley':
      for (let v = 0; v < (half ? 4 : 3); v++) later(e, v * 0.22, () => {
        const a = Math.atan2(target.y - e.y, target.x - e.x);
        for (let i = -1; i <= 1; i++) enemyBullet(state, e, a + i * 0.15, 300);
      });
      break;
    case 'arrowRain':
      for (let i = 0; i < (half ? 14 : 10); i++) {
        const a = Math.random() * Math.PI * 2, d = i === 0 ? 0 : 40 + Math.random() * 170;
        addHazard(state, { k: 'circle', x: target.x + Math.cos(a) * d, y: target.y + Math.sin(a) * d, r: 38, warn: 0.8 + i * 0.06, dmg, src: e.id, c: '#ce93d8' });
      }
      break;
    case 'teleport': {
      addFx(state, { k: 'r', x: e.x, y: e.y, r: e.r + 20, c: e.color, t: 0.4, life: 0.4 });
      const spot = randomRoomSpot(state, e.room, target, 170);
      e.x = spot.x; e.y = spot.y;
      addFx(state, { k: 'r', x: e.x, y: e.y, r: e.r + 20, c: e.color, t: 0.4, life: 0.4 });
      later(e, 0.35, () => ring(state, e, e.x, e.y, Math.round(14 * more), 190, Math.random(), 0, { r: 6 }));
      break;
    }
    case 'homing':
      for (let i = 0; i < (half ? 7 : 5); i++) later(e, i * 0.12, () => enemyBullet(state, e, angle + Math.PI + (i - 2) * 0.5, 175, { home: 2.2, life: 4, r: 7 }));
      break;
    case 'spiral':
      e.act = 'spiral'; e.actT = 2.2;
      break;
    case 'wall': {
      // 빈틈이 있는 탄막 벽
      const n = 15, gap = 2 + Math.floor(Math.random() * (n - 5));
      const nx = -Math.sin(angle), ny = Math.cos(angle);
      for (let i = 0; i < n; i++) {
        if (i >= gap && i < gap + 3) continue;
        const off = (i - (n - 1) / 2) * 24;
        enemyBullet(state, { ...e, x: e.x + nx * off, y: e.y + ny * off }, angle, 170, { life: 4, r: 7 });
      }
      break;
    }
    case 'laser': {
      e.act = 'laser'; e.actT = 3;
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (let i = 0; i < (half ? 4 : 3); i++) {
        addHazard(state, { k: 'laser', x: e.x, y: e.y, a: angle + 0.6 + (i / (half ? 4 : 3)) * Math.PI * 2, len: 640, w: 18, warn: 0.9, dur: 2.1, spin: 0.7 * dir, dmg, src: e.id });
      }
      break;
    }
    case 'shockwave':
      for (let i = 0; i < 3; i++) later(e, i * 0.5, () => {
        addFx(state, { k: 'r', x: e.x, y: e.y, r: e.r + 30, c: '#ffab40', t: 0.3, life: 0.3 });
        ring(state, e, e.x, e.y, 30, 150, i * 0.1, 4, { r: 7, life: 3.5 });
      });
      break;
    case 'rock': {
      const alive = Object.values(state.players).filter((p) => p.alive);
      for (let i = 0; i < (half ? 9 : 6); i++) {
        const t = i < alive.length ? alive[i] : randomRoomSpot(state, e.room);
        addHazard(state, { k: 'circle', x: t.x, y: t.y, r: 48, warn: 1.1 + i * 0.08, dmg: dmg + 1, src: e.id, after: 'shards', c: '#a1887f' });
      }
      break;
    }
    case 'charge':
      e.act = 'chargeWarn'; e.actT = 0.6; e.chargeA = angle;
      addHazard(state, { k: 'line', x: e.x, y: e.y, a: angle, len: 520, w: e.r * 2, warn: 0.6, src: e.id });
      break;
    case 'sweep': {
      e.act = 'laser'; e.actT = 2.6;
      const dir = Math.random() < 0.5 ? 1 : -1;
      addHazard(state, { k: 'laser', x: e.x, y: e.y, a: angle - dir * 1.5, len: 720, w: 24, warn: 0.75, dur: 1.8, spin: dir * 1.7, dmg: dmg + 1, src: e.id });
      break;
    }
    default:
  }
}

function updateBoss(state, e, alivePlayers, dt) {
  const target = nearest(state.castle ? [...alivePlayers, state.castle] : alivePlayers, e.x, e.y);
  if (!target) return;
  const half = e.hp < e.maxHp / 2;
  const angle = Math.atan2(target.y - e.y, target.x - e.x);
  const T = ENEMY_TYPES.boss;

  // 예약된 탄
  for (const s of e.sched) s.at -= dt;
  const due = e.sched.filter((s) => s.at <= 0);
  e.sched = e.sched.filter((s) => s.at > 0);
  for (const s of due) s.fn();

  if (e.act === 'jump') {
    e.actT -= dt;
    const k = 1 - Math.max(0, e.actT) / 0.9;
    e.x = e.jx + (e.tx - e.jx) * k;
    e.y = e.jy + (e.ty - e.jy) * k;
    e.air = e.actT > 0.1;
    if (e.actT <= 0) { e.act = null; e.air = false; }
  } else if (e.act === 'chargeWarn') {
    e.actT -= dt;
    if (e.actT <= 0) { e.act = 'charge'; e.actT = 0.7; }
  } else if (e.act === 'charge') {
    e.actT -= dt;
    const bx = e.x, by = e.y;
    moveCircle(state, e, Math.cos(e.chargeA) * 480 * dt, Math.sin(e.chargeA) * 480 * dt, true);
    const stuck = Math.hypot(e.x - bx, e.y - by) < 2;
    if (stuck) {
      ring(state, e, e.x, e.y, 10, 180, Math.random());
      addFx(state, { k: 'r', x: e.x, y: e.y, r: 70, c: '#ffab40', t: 0.3, life: 0.3 });
    }
    if (e.actT <= 0 || stuck) e.act = null;
  } else if (e.act === 'spiral') {
    e.actT -= dt;
    e.spin += dt;
    e.tick = (e.tick || 0) - dt;
    if (e.tick <= 0) {
      e.tick = half ? 0.07 : 0.1;
      const arms = half ? 3 : 2;
      for (let k = 0; k < arms; k++) enemyBullet(state, e, e.spin * 4 + (k * Math.PI * 2) / arms, 200);
    }
    if (e.actT <= 0) e.act = null;
  } else if (e.act === 'laser') {
    e.actT -= dt; // 레이저를 쏘는 동안 제자리
    if (e.actT <= 0) e.act = null;
  } else {
    // 천천히 다가옴
    const d = Math.hypot(target.x - e.x, target.y - e.y);
    const slow = e.st.chill > 0 ? 0.6 : 1;
    if (d > 130) moveCircle(state, e, Math.cos(angle) * T.speed * dt * slow, Math.sin(angle) * T.speed * dt * slow, true);
    e.patT -= dt;
    if (e.patT <= 0) {
      // 같은 패턴을 연달아 쓰지 않음. 체력이 절반 아래면 더 자주, 가끔 두 패턴을 겹침
      const choices = e.pats.filter((p) => p !== e.last);
      const pat = choices[Math.floor(Math.random() * choices.length)];
      e.last = pat;
      e.patT = half ? 1.7 : 2.4;
      bossPattern(state, e, pat, target, half);
      if (half && !e.act && Math.random() < 0.35) bossPattern(state, e, Math.random() < 0.5 ? 'volley' : 'ring', target, half);
    }
  }
  // 몸으로 부딪히면 피해 (공중에 뜬 동안은 X)
  if (e.air) return;
  const c = state.castle;
  if (c && e.cd <= 0 && Math.hypot(c.x - e.x, c.y - e.y) < c.r + e.r + 6) { damageCastle(state, 3); e.cd = 1; }
  for (const u of state.units) if (e.cd <= 0 && Math.hypot(u.x - e.x, u.y - e.y) < u.r + e.r) { damageUnit(state, u, 6); e.cd = 0.6; }
  for (const p of alivePlayers) {
    if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r && e.cd <= 0) { damagePlayer(state, p, T.touch + e.sc.dmg - 1); e.cd = 0.8; }
  }
}

function updateEnemy(state, e, alivePlayers, dt) {
  const T = ENEMY_TYPES[e.kind];
  e.hitT = Math.max(0, e.hitT - dt);
  if (!updateStatus(state, e, dt) || e.hp <= 0) return; // 빙결/기절 중엔 아무것도 못 함
  e.cd -= dt;
  e.t += dt;
  if (!e.sc) e.sc = enemyScale(0);
  if (e.kind === 'boss') { updateBoss(state, e, alivePlayers, dt); return; }
  const slow = (e.st.wet > 0 ? 0.8 : 1) * (e.st.chill > 0 ? 0.6 : 1);
  const target = enemyTarget(state, e, alivePlayers);
  if (!target) return;

  const dx = target.x - e.x, dy = target.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  // 움직일 방향: 목표가 보이면 똑바로, 벽 너머면 길을 따라 돌아감
  const pd = pathDir(state, e, target, dt);
  const blind = !!pd;
  const ux = pd ? pd[0] : dx / d, uy = pd ? pd[1] : dy / d;
  let vx = ux, vy = uy, spMul = 1;
  let touch = !!T.touch;

  switch (e.kind) {
    case 'archer':
      if (blind) break; // 벽 너머: 쏘지 않고 길 따라 다가감
      if (Math.random() < dt * 0.5) e.strafe *= -1;
      if (d > 260) { vx = ux; vy = uy; } else if (d < 170) { vx = -ux; vy = -uy; } else { vx = -uy * e.strafe; vy = ux * e.strafe; }
      if (e.cd <= 0 && d < 420) {
        e.cd = (T.fireEvery + Math.random() * 0.5) / e.sc.speed;
        enemyBullet(state, e, Math.atan2(dy, dx), T.bulletSpeed);
      }
      break;
    case 'bat': {
      // 지그재그로 날아옴
      const w = Math.sin(e.t * 7) * 0.9;
      vx = ux - uy * w; vy = uy + ux * w;
      break;
    }
    case 'spider':
      // 멈춰서 노리다가 순간 도약
      e.modeT -= dt;
      if (e.modeT <= 0) { e.mode = e.mode ? 0 : 1; e.modeT = e.mode ? 0.35 : 0.9 + Math.random() * 0.5; e.lx = ux; e.ly = uy; }
      if (e.mode) { vx = e.lx; vy = e.ly; spMul = 3.6; } else spMul = 0.25;
      break;
    case 'bomber':
      if (e.fuse > 0) {
        e.fuse -= dt;
        spMul = 0;
        if (e.fuse <= 0) {
          addFx(state, { k: 'r', x: e.x, y: e.y, r: 70, c: '#ff7043', t: 0.4, life: 0.4 });
          for (const p of playersInCircle(state, e.x, e.y, 70)) damagePlayer(state, p, e.sc.dmg + 1);
          for (const u of state.units) if (Math.hypot(u.x - e.x, u.y - e.y) < 70 + u.r) damageUnit(state, u, 4);
          if (state.castle && Math.hypot(state.castle.x - e.x, state.castle.y - e.y) < 70 + state.castle.r) damageCastle(state, 2);
          for (const o of enemiesNear(state, e.x, e.y, 70)) if (o !== e) damageEnemy(state, o, 3);
          e.hp = 0;
          e.lastHit = null; // 스스로 터지면 점수 없음
          return;
        }
      } else if (d > 90 && !blind) {
        // 무빙: 좌우로 흔들며 접근
        const w = Math.sin(e.t * 5 + e.id) * 0.7;
        vx = ux - uy * w; vy = uy + ux * w;
      } else if (d < 52) {
        e.fuse = 0.7;
        floatText(state, e.x, e.y - e.r - 8, '!', '#ff5252', 0.6);
      }
      break;
    case 'caster':
      if (blind) break;
      if (d > 300) { vx = ux; vy = uy; } else if (d < 200) { vx = -ux; vy = -uy; } else { vx = -uy * e.strafe * 0.5; vy = ux * e.strafe * 0.5; }
      if (e.cd <= 0 && d < 460) {
        e.cd = (T.fireEvery + Math.random() * 0.6) / e.sc.speed;
        const a = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i++) enemyBullet(state, e, a + i * 0.35, T.bulletSpeed, { home: 1.6, life: 3.5, r: 6 });
      }
      e.modeT -= dt;
      if (e.modeT <= 0) {
        // 순간이동: 플레이어 근처 다른 곳으로
        e.modeT = 4 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        const spot = freeSpotNear(state, target.x + Math.cos(a) * 230, target.y + Math.sin(a) * 230);
        if (!circleBlocked(state, spot.x, spot.y, e.r, true) && roomAt(state, spot.x, spot.y) === roomAt(state, e.x, e.y)) {
          addFx(state, { k: 'r', x: e.x, y: e.y, r: 22, c: '#9575cd', t: 0.3, life: 0.3 });
          e.x = spot.x; e.y = spot.y;
          addFx(state, { k: 'r', x: e.x, y: e.y, r: 22, c: '#9575cd', t: 0.3, life: 0.3 });
        }
      }
      break;
    case 'shield': {
      // 방패를 플레이어 쪽으로 천천히 돌림 (앞에서 오는 총알을 막음)
      let da = Math.atan2(dy, dx) - e.face;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      e.face += Math.max(-1.8 * dt, Math.min(1.8 * dt, da));
      break;
    }
    case 'elite':
      // 정예: 3.5초마다 주변을 내려찍음 (빨간 경고 원)
      e.modeT -= dt;
      if (e.modeT <= 0) {
        e.modeT = 3.5;
        addHazard(state, { k: 'circle', x: e.x, y: e.y, r: 100, warn: 0.9, dmg: e.sc.dmg + 1, src: e.id, after: 'ring' });
        e.slamT = 0.9;
      }
      if (e.slamT > 0) { e.slamT -= dt; spMul = 0; }
      break;
    case 'totem':
      spMul = 0;
      if (e.cd <= 0) {
        e.cd = T.fireEvery / e.sc.speed;
        e.face += 0.45;
        for (let k = 0; k < 3; k++) enemyBullet(state, e, e.face + (k * Math.PI * 2) / 3, T.bulletSpeed);
      }
      break;
    default:
  }
  if (e.kind !== 'shield' && e.kind !== 'totem') e.face = Math.atan2(dy, dx);

  if (touch && d < e.r + (target.r || PLAYER_RADIUS) + 4 && e.cd <= 0) {
    hitTarget(state, target, T.touch + e.sc.dmg - 1);
    e.cd = 0.8;
  }

  // 회피 (빠른 적): 회피 중엔 옆으로 빠르게
  if (DODGE[e.kind] && !e.fuse) tryDodge(state, e, dt);
  if (e.dodgeT > 0) { e.dodgeT -= dt; vx = e.dvx; vy = e.dvy; spMul = 3.2; }
  // 끼임 풀기: 0.5초 동안 거의 못 움직였으면 잠깐 옆으로 비켜 감
  if (e.unstuckT > 0) { e.unstuckT -= dt; vx = e.usx; vy = e.usy; spMul = Math.max(spMul, 1); }

  const sp = T.speed * e.sc.speed * slow * spMul * dt;
  if (sp <= 0) return;
  const ox = e.x, oy = e.y;
  const blocker = moveCircle(state, e, vx * sp, vy * sp, true);
  e.stuckT = (e.stuckT || 0) + dt;
  e.stuckD = (e.stuckD || 0) + Math.hypot(e.x - ox, e.y - oy);
  if (e.stuckT >= 0.5) {
    if (e.stuckD < sp / dt * 0.5 * 0.15 && !blocker && !(e.unstuckT > 0)) {
      const sgn = Math.random() < 0.5 ? 1 : -1;
      e.usx = -vy * sgn; e.usy = vx * sgn; e.unstuckT = 0.45;
      e.losT = 0; // 길 다시 보기
    }
    e.stuckT = 0; e.stuckD = 0;
  }
  if (blocker && touch && e.cd <= 0) {
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
    s.cd = s.fast ? 0.3 : T.fireEvery;
    const a = Math.atan2(target.y - y, target.x - x);
    s.angle = a;
    state.bullets.push({
      id: state.nextId++, owner: 'p', shooter: s.owner, x, y,
      vx: Math.cos(a) * T.bulletSpeed, vy: Math.sin(a) * T.bulletSpeed,
      r: 4, dmg: 1, life: 0.8, pierce: 0, bounce: 0, hits: [], el: null, elv: 0, kind: 'turret',
    });
  }
}

// 구슬 뿌리기: k = 'x' 경험치, 'm' 마나, 'g' 동전
function dropOrbs(state, x, y, k, count, spread, value = 1) {
  if (state.orbs.length >= MAX_ORBS) {
    // 구슬이 너무 많으면 가까운 같은 종류 구슬(아무도 안 주운 것)에 합침
    const o = nearest(state.orbs.filter((q) => q.k === k && !q.taken.length), x, y, 400);
    if (o) { o.v += value * count; return; }
  }
  for (let i = 0; i < count && state.orbs.length < MAX_ORBS; i++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * spread;
    const spot = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
    const ok = !wallAtPoint(state, spot.x, spot.y);
    state.orbs.push({ id: state.nextId++, k, x: ok ? spot.x : x, y: ok ? spot.y : y, v: value, taken: [], t: ORB_LIFE });
  }
}

function killEnemy(state, e) {
  const T = ENEMY_TYPES[e.kind];
  const boss = e.kind === 'boss';
  // 쓰러진 모습 + 빠져나가는 영혼
  addFx(state, { k: 'die', x: e.x, y: e.y, ek: e.kind, r: e.r, c: e.color || 0, t: 1.4, life: 1.4 });
  const camp = state.mode === 'camp';
  if (camp) {
    // 생존 모드: 적이 아주 많으니 골드·정수는 조금씩
    state.kills = (state.kills || 0) + 1;
    state.goldFrac = (state.goldFrac || 0) + T.gold * 0.5;
    state.gold += Math.floor(state.goldFrac);
    state.goldFrac %= 1;
    if (e.kind === 'elite') { spawnChest(state, e.x, e.y); state.chests[state.chests.length - 1].elite = true; }
    if (Math.random() < 0.012 && state.orbs.length < MAX_ORBS) state.orbs.push({ id: state.nextId++, k: 'h', x: e.x, y: e.y, v: 1, taken: [], t: ORB_LIFE });
  }
  giveEssence(state, (ESSENCE[e.kind] ?? ESSENCE.default) * (camp && e.kind !== 'boss' ? 0.3 : 1));
  const spread = boss ? 46 : 14;
  if (!camp) dropOrbs(state, e.x, e.y, 'x', T.xp, spread); // 성 지키기는 레벨업 없음
  const mn = Math.max(1, Math.round(T.mp / 4));
  dropOrbs(state, e.x, e.y, 'm', boss ? 8 : mn, spread, boss ? T.mp / 8 : T.mp / mn);
  if (state.mode !== 'camp') {
    const gn = Math.min(boss ? 12 : 4, T.gold);
    dropOrbs(state, e.x, e.y, 'g', gn, spread, T.gold / gn);
  }
  // 큰 슬라임: 작은 슬라임 둘로 갈라짐
  if (e.kind === 'bigslime') {
    for (const s of [-1, 1]) {
      const spot = freeSpotNear(state, e.x + s * 14, e.y);
      const kid = makeEnemy(state, 'slime', spot.x, spot.y, state.mode === 'camp' ? state.wave * 0.6 : state.stageIdx);
      state.enemies.push(kid);
    }
  }
  // 불씨 특성: 화상 걸린 적이 쓰러지면 작은 폭발
  if (e.st.burn > 0) {
    const owner = state.players[e.st.burnBy];
    if (hasPerk(owner, 'ember')) {
      addFx(state, { k: 'r', x: e.x, y: e.y, r: 60, c: '#ff7043', t: 0.3, life: 0.3 });
      for (const o of enemiesNear(state, e.x, e.y, 60)) if (o !== e) damageEnemy(state, o, 2, owner.id);
    }
  }
  const shooter = state.players[e.lastHit];
  if (!shooter) return;
  shooter.score += T.score;
  chargeUlt(shooter, 'gun', 'stack', 1);
  const vamp = stats(shooter).vamp;
  if (vamp > 0 && shooter.alive && Math.random() < vamp) heal(shooter, 1);
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

function blastAt(state, b, x, y, except) {
  addFx(state, { k: 'r', x, y, r: b.blast, c: ELEMENTS[b.el]?.color || '#ffcc80', t: 0.3, life: 0.3 });
  for (const o of enemiesNear(state, x, y, b.blast)) {
    if (o === except) continue;
    damageEnemy(state, o, b.dmg / 2, b.shooter);
    if (b.kind === 'fireball' && o.hp > 0) applyElement(state, o, b);
  }
}

// 플레이어 총알이 적에게 맞았을 때 (패시브·전직 특성)
function bulletHitEnemy(state, b, e) {
  // 방패병: 앞에서 오는 총알은 막음
  if (e.kind === 'shield' && b.kind !== 'javelin' && angleDiff(Math.atan2(-b.vy, -b.vx), e.face) < 1.15) {
    addFx(state, { k: 'r', x: b.x, y: b.y, r: 10, c: '#cfd8dc', t: 0.15, life: 0.15 });
    if (state.fx.length < 220) state.fx.push({ k: 'dn', x: e.x, y: e.y - e.r, v: '막음', g: 'block', t: 0.5, life: 0.5 });
    return false;
  }
  let dmg = b.dmg;
  const p = state.players[b.shooter];
  if (p && b.fam === 'bow' && b.kind !== 'wave') {
    // 활 패시브: 약점 포착
    if (p.markId === e.id) p.markN = Math.min(3, p.markN + 1);
    else { p.markId = e.id; p.markN = 0; }
    dmg += p.markN;
  }
  if (b.falloff) {
    // 샷건: 가까울수록 강함 (50px 이내 150% → 멀어질수록 50%까지)
    const d = Math.hypot(e.x - b.sx, e.y - b.sy);
    dmg *= Math.max(0.5, Math.min(1.5, 1.5 - (d - 50) / 120));
  }
  damageEnemy(state, e, dmg, b.shooter, b.crit ? 'crit' : '');
  if (p && !['icespike', 'icelance', 'fireball'].includes(b.kind)) staticChain(state, p, e);
  // 산탄·여러 총열: 피해는 총알마다, 속성 효과는 한 묶음에 적 하나당 한 번
  const first = !b.vol || !b.vol.hit.has(e.id);
  if (b.vol) b.vol.hit.add(e.id);
  if (first && b.el && e.hp > 0) applyElement(state, e, b);
  if (first && b.vol?.el2 && e.hp > 0) comboHit(state, e, b.vol.el2, b.vol.elv2, b.shooter, b.vx, b.vy);
  if (b.freeze && e.hp > 0) e.st.frozen = Math.max(e.st.frozen, b.freeze);
  if (b.blast) blastAt(state, b, e.x, e.y, e);
  return true;
}

function updateJavelin(state, b, dt) {
  const owner = state.players[b.shooter];
  if (!owner || owner.javelin !== b.id) { b.dead = true; return; }
  if (b.returning) {
    const dx = owner.x - b.x, dy = owner.y - b.y, d = Math.hypot(dx, dy) || 1;
    b.vx = (dx / d) * 820;
    b.vy = (dy / d) * 820;
    if (d < 20) { b.dead = true; owner.javelin = null; return; }
  } else if (b.stuck) {
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; owner.javelin = null; }
    return;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (!b.returning && wallAtPoint(state, b.x, b.y)) {
    b.x -= b.vx * dt;
    b.y -= b.vy * dt;
    b.stuck = true;
    b.life = 6;
    return;
  }
  for (const e of state.enemies) {
    if (e.hp <= 0 || b.hits.includes(e.id)) continue;
    if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
      b.hits.push(e.id);
      bulletHitEnemy(state, b, e);
    }
  }
}

function updateBullets(state, dt) {
  for (const b of state.bullets) {
    if (b.dead) continue;
    if (b.kind === 'javelin') { updateJavelin(state, b, dt); continue; }
    if (b.home > 0) steerBullet(state, b, dt);
    if (b.kind === 'boomerang') {
      // 부메랑: 날아가다가 주인에게 돌아옴 (벽 통과)
      b.out -= dt;
      const owner = state.players[b.shooter];
      if (b.out <= 0 && owner) {
        if (!b.back) { b.back = true; b.hits = []; }
        const dx = owner.x - b.x, dy = owner.y - b.y, d = Math.hypot(dx, dy) || 1;
        b.vx = (dx / d) * 520; b.vy = (dy / d) * 520;
        if (d < 18) { b.dead = true; continue; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      for (const e of state.enemies) {
        if (e.hp <= 0 || b.hits.includes(e.id)) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) { b.hits.push(e.id); damageEnemy(state, e, b.dmg, b.shooter); }
      }
      const br = state.barrels.length ? barrelAt(state, b.x, b.y, b.r) : null;
      if (br) hitBarrel(state, br, 1, b.shooter);
      continue;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || bulletHitsWall(state, b, dt)) {
      b.dead = true;
      if (b.blastWall) blastAt(state, b, b.x - b.vx * dt, b.y - b.vy * dt, null);
      continue;
    }

    if (b.owner === 'p') {
      const br = state.barrels.length ? barrelAt(state, b.x, b.y, b.r) : null;
      if (br) { hitBarrel(state, br, b.dmg, b.shooter); if (b.kind !== 'boomerang') { b.dead = true; continue; } }
      for (const e of state.enemies) {
        if (e.hp <= 0 || b.hits.includes(e.id)) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
          const hit = bulletHitEnemy(state, b, e);
          if (hit && b.pierce > 0) { b.pierce--; b.hits.push(e.id); }
          else { b.dead = true; break; }
        }
      }
    } else {
      const s = structAt(state, Math.floor(b.x / TILE), Math.floor(b.y / TILE));
      if (s) { damageStruct(state, s, b.dmg); b.dead = true; continue; }
      const c = state.castle;
      if (c && (c.x - b.x) ** 2 + (c.y - 10 - b.y) ** 2 < (c.r + b.r) ** 2) { damageCastle(state, b.dmg * 0.4); b.dead = true; continue; }
      const u = state.units.find((o) => o.hp > 0 && (o.x - b.x) ** 2 + (o.y - b.y) ** 2 < (o.r + b.r) ** 2);
      if (u) { damageUnit(state, u, b.dmg * 1.5); b.dead = true; continue; }
      for (const p of Object.values(state.players)) {
        if (!p.alive || p.invuln > 0) continue;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < (p.r + b.r) ** 2) {
          b.dead = true;
          // 기사 패시브: 방패가 준비돼 있으면 한 발 막음
          if (p.char === 'knight' && p.shieldT <= 0) {
            p.shieldT = KNIGHT_SHIELD;
            addFx(state, { k: 'r', x: p.x, y: p.y, r: 22, c: '#90caf9', t: 0.3, life: 0.3 });
            floatText(state, p.x, p.y - 30, '막음!', '#90caf9', 0.6);
            break;
          }
          damagePlayer(state, p, b.dmg);
          break;
        }
      }
    }
  }
  state.bullets = state.bullets.filter((b) => !b.dead);
}

// 수류탄·메테오 (날아가서 터짐), 지속 구역 (화살비·소용돌이·뇌우·토네이도·독구름)
function updateGrenadesAndZones(state, dt) {
  for (const g of state.grenades) {
    g.t += dt;
    if (g.t < g.dur) continue;
    g.dead = true;
    if (g.kind === 'molotov') {
      // 화염병: 떨어진 자리에 불바다
      state.zones.push({ id: state.nextId++, kind: 'fire', x: g.tx, y: g.ty, r: g.r, t: g.life, tick: 0, every: 0.4, src: g.src, dmg: g.burn, el: 'fire', elv: 1, elChance: 0.25 });
      continue;
    }
    addFx(state, { k: 'r', x: g.tx, y: g.ty, r: g.r, c: g.kind === 'meteor' ? '#ff7043' : '#ffab40', t: 0.4, life: 0.4 });
    if (g.kind === 'meteor') addFx(state, { k: 'r', x: g.tx, y: g.ty, r: g.r * 0.6, c: '#ffd54f', t: 0.3, life: 0.3 });
    for (const e of enemiesNear(state, g.tx, g.ty, g.r)) {
      damageEnemy(state, e, g.dmg, g.src);
      if (g.el && e.hp > 0) applyElement(state, e, { el: g.el, elv: g.elv, shooter: g.src, vx: e.x - g.tx, vy: e.y - g.ty });
    }
  }
  state.grenades = state.grenades.filter((g) => !g.dead);

  for (const z of state.zones) {
    z.t -= dt;
    if (z.follow) {
      const owner = state.players[z.follow];
      if (owner) { z.x = owner.x; z.y = owner.y; }
    }
    if (z.vx) {
      // 토네이도: 앞으로 나아가다 벽에서 멈춤
      const nx = z.x + z.vx * dt, ny = z.y + z.vy * dt;
      if (!wallAtPoint(state, nx, ny)) { z.x = nx; z.y = ny; }
    }
    if (z.pull) {
      for (const e of enemiesNear(state, z.x, z.y, z.r + 30)) {
        const d = Math.hypot(z.x - e.x, z.y - e.y);
        if (d > 6) push(state, e, (z.x - e.x) / d, (z.y - e.y) / d, Math.min(d, z.pull * dt));
      }
    }
    z.tick -= dt;
    if (z.tick > 0) continue;
    z.tick = z.every;
    const inside = enemiesNear(state, z.x, z.y, z.r);
    if (z.kind === 'storm') {
      const e = shuffle(inside)[0];
      if (e) {
        addFx(state, { k: 'l', x: e.x, y: e.y - 200, x2: e.x, y2: e.y, c: '#fff176', t: 0.25, life: 0.25 });
        damageEnemy(state, e, z.dmg, z.src);
        if (e.hp > 0) applyElement(state, e, { el: z.el, elv: z.elv, shooter: z.src, vx: 0, vy: 1 });
      }
      continue;
    }
    for (const e of inside) {
      if (z.dmg) damageEnemy(state, e, z.dmg, z.src);
      if (z.el && e.hp > 0 && Math.random() < (z.elChance ?? 1)) applyElement(state, e, { el: z.el, elv: z.elv, shooter: z.src, vx: e.x - z.x, vy: e.y - z.y });
    }
  }
  state.zones = state.zones.filter((z) => z.t > 0);
}

// ---------- 함정 ----------
// 가시·화염 분사구는 시간에 맞춰 반복 (state.time 기준이라 참가자 화면도 같은 박자로 그림)
function loadTraps(state) {
  const traps = state.map.traps || [];
  state.barrels = traps.filter((t) => t.k === 'barrel').map((t) => ({ ...t, hp: TRAPS.barrel.hp }));
}

const trapPhase = (state, t, cycle) => (state.time + t.off) % cycle;

// 한 주기에 한 번만 맞도록 (key = 함정 id + 주기 번호)
function trapOnce(obj, key) {
  if (obj.trapKey === key) return false;
  obj.trapKey = key;
  return true;
}

function hitByTrap(state, t, x, y, r) {
  if (t.k === 'spike') return Math.abs(x - t.x) < TILE / 2 + r * 0.6 && Math.abs(y - t.y) < TILE / 2 + r * 0.6;
  if (t.k === 'vent') {
    const ux = [1, 0, -1, 0][t.a], uy = [0, 1, 0, -1][t.a];
    const rx = x - t.x, ry = y - t.y, along = rx * ux + ry * uy, side = Math.abs(rx * uy - ry * ux);
    return along > -10 && along < TRAPS.vent.len + 10 && side < TRAPS.vent.w / 2 + r;
  }
  return false;
}

function updateTraps(state, dt) {
  const players = Object.values(state.players).filter((p) => p.alive);
  for (const p of players) { p.slowT = Math.max(0, (p.slowT || 0) - dt); p.poisonT = Math.max(0, (p.poisonT || 0) - dt); }
  for (const t of state.map.traps || []) {
    if (t.k === 'barrel') continue;
    // 가까운 것만 계산
    const near = (o) => Math.abs(o.x - t.x) < 140 && Math.abs(o.y - t.y) < 140;
    if (t.k === 'poison') {
      const R = TRAPS.poison.r;
      for (const p of players) {
        if (!near(p) || Math.hypot(p.x - t.x, p.y - t.y) > R + p.r * 0.5) continue;
        p.slowT = 0.2;
        if (p.poisonT <= 0) { p.poisonT = TRAPS.poison.every; damagePlayer(state, p, TRAPS.poison.dmg); }
      }
      if (Math.floor(state.time) !== Math.floor(state.time - dt)) {
        for (const e of enemiesNear(state, t.x, t.y, R)) applyElement(state, e, { el: 'poison', elv: 1, vx: 0, vy: 1 });
      }
      continue;
    }
    const D = TRAPS[t.k];
    const ph = trapPhase(state, t, D.cycle);
    if (ph < D.on) continue;
    const key = t.id * 100000 + Math.floor((state.time + t.off) / D.cycle);
    for (const p of players) {
      if (near(p) && p.dashT <= 0 && hitByTrap(state, t, p.x, p.y, p.r) && trapOnce(p, key)) damagePlayer(state, p, D.dmg);
    }
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.air || !near(e) || !hitByTrap(state, t, e.x, e.y, e.r) || !trapOnce(e, key)) continue;
      damageEnemy(state, e, D.edmg * (e.kind === 'boss' ? 2 : 1), e.lastHit);
      if (t.k === 'vent' && e.hp > 0) applyElement(state, e, { el: 'fire', elv: 1, shooter: e.lastHit, vx: 0, vy: 1 });
    }
  }
}

// 폭발 통: 맞으면 터져서 주변 적에게 큰 피해 (다른 통도 연쇄 폭발)
function hitBarrel(state, b, dmg, src) {
  if (b.hp <= 0) return;
  b.hp -= dmg > 0 ? 1 : 0;
  if (b.hp > 0) return;
  const D = TRAPS.barrel;
  addFx(state, { k: 'r', x: b.x, y: b.y, r: D.r, c: '#ff7043', t: 0.45, life: 0.45 });
  addFx(state, { k: 'r', x: b.x, y: b.y, r: D.r * 0.55, c: '#ffd54f', t: 0.3, life: 0.3 });
  for (const e of enemiesNear(state, b.x, b.y, D.r)) {
    damageEnemy(state, e, D.edmg, src);
    if (e.hp > 0) {
      const d = Math.hypot(e.x - b.x, e.y - b.y) || 1;
      push(state, e, (e.x - b.x) / d, (e.y - b.y) / d, 40);
    }
  }
  for (const p of playersInCircle(state, b.x, b.y, D.r * 0.7)) damagePlayer(state, p, D.dmg);
  for (const o of state.barrels) if (o !== b && o.hp > 0 && Math.hypot(o.x - b.x, o.y - b.y) < D.r) hitBarrel(state, o, 1, src);
}

function barrelAt(state, x, y, r) {
  return state.barrels.find((b) => b.hp > 0 && (b.x - x) ** 2 + (b.y - y) ** 2 < (r + 13) ** 2);
}

// ---------- 성 지키기: 성과 군단 ----------
// 성(탑)은 맵 가운데. 적은 가까운 플레이어·유닛이 없으면 성으로 갑니다. 성이 무너지면 패배.
function setupCastle(state) {
  const m = state.map;
  const players = Object.values(state.players);
  const best = (k) => Math.max(0, ...players.map((p) => p.bb?.[k] || 0));
  const guildHp = Math.max(0, ...players.map((p) => (p.guild ? guildPerks(p.guild.lv).castleHp : 0)));
  const wall = players.some((p) => ownsTreasure(p, 'b_wall')) ? 30 : 0; // 성벽 문장 (모험 보물)
  state.castle = { x: m.castle.x, y: m.castle.y, r: CASTLE.r, hp: 1, maxHp: 1, lv: 1, cd: 1, a: 0, arrow: 1 + best('castleArrow'), mounts: [],
    baseHp: (CASTLE.hp + best('castleHp') + guildHp + wall), pct: best('castlePct') };
  applyKeep(state, true);
  state.gold = CASTLE.startGold + best('startGold');
  state.units = [];
}

// 방장의 성 키우기 정보(레벨·거치 무기)를 성에 적용. full: 체력을 가득 채움
function applyKeep(state, full = false) {
  const c = state.castle;
  if (!c) return;
  const keep = state.players[state.hostId]?.build?.keep || { lv: 1, mounts: [] };
  c.lv = keep.lv;
  const maxHp = Math.round((c.baseHp + KEEP.hpPerLv * (keep.lv - 1)) * (1 + c.pct));
  c.hp = full ? maxHp : Math.min(maxHp, c.hp + Math.max(0, maxHp - c.maxHp));
  c.maxHp = maxHp;
  const old = c.mounts || [];
  c.mounts = keep.mounts.map((w, i) => ({ ...w, cd: old[i]?.cd ?? 0.5 + i * 0.2, a: old[i]?.a ?? -Math.PI / 2 }));
}
// 거치대 자리 (성 그림의 탑 위)
const MOUNT_POS = [[-30, -52], [30, -52], [-44, -10], [44, -10]];

function damageCastle(state, dmg) {
  const c = state.castle;
  if (!c || c.hp <= 0 || state.phase !== 'playing') return;
  c.hp -= dmg;
  c.hitT = 0.15;
  if (c.hp <= 0) { c.hp = 0; campDefeat(state, '성이 무너졌다!'); }
}


function updateCastle(state, dt) {
  const c = state.castle;
  if (!c) return;
  c.hitT = Math.max(0, (c.hitT || 0) - dt);
  if (state.campPhase !== 'fight') return;
  const alive = state.enemies.filter((e) => e.hp > 0);
  // 성 화살: 성 레벨마다 강해짐 (Lv10 2발, Lv25 3발)
  c.cd -= dt;
  const t = c.cd <= 0 && nearest(alive, c.x, c.y, CASTLE.range + 4 * c.lv);
  if (t) {
    c.cd = CASTLE.arrowEvery / (1 + 0.02 * (c.lv - 1));
    c.a = Math.atan2(t.y - c.y, t.x - c.x);
    const n = c.lv >= 25 ? 3 : c.lv >= 10 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = c.a + (i - (n - 1) / 2) * 0.12;
      state.bullets.push({
        id: state.nextId++, owner: 'p', shooter: null, kind: 'bow', fam: 'bow', x: c.x + Math.cos(a) * (c.r + 6), y: c.y + Math.sin(a) * (c.r + 6),
        vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, r: 5, dmg: CASTLE.arrowDmg * (1 + KEEP.arrowPerLv * (c.lv - 1)) * c.arrow * (state.volley ? 1.5 : 1),
        life: 0.7, pierce: 0, bounce: 0, hits: [], el: null, elv: 0,
      });
    }
  }
  // 거치한 무기: 모험에서 가져온 무기가 탑 위에서 자동 공격 (속성 그대로)
  const mul = KEEP.mountMul(c.lv) * (state.volley ? 1.5 : 1);
  c.mounts.forEach((m, i) => {
    const W = WEAPONS[m.k];
    if (!W) return;
    m.cd -= dt;
    if (m.cd > 0) return;
    const [ox, oy] = MOUNT_POS[i] || [0, 0];
    const mx = c.x + ox, my = c.y + oy;
    if (W.kind !== 'ranged') {
      // 근접 무기: 성 둘레를 크게 휩쓸기
      const R = c.r + 80;
      const hit = alive.filter((e) => Math.hypot(e.x - c.x, e.y - c.y) < R + e.r);
      if (!hit.length) return;
      m.cd = W.cd * KEEP.mountCd * 1.5;
      for (const e of hit) { damageEnemy(state, e, W.dmg * mul, null); if (m.el && e.hp > 0) applyElement(state, e, { el: m.el, elv: m.lv, shooter: null, vx: e.x - c.x, vy: e.y - c.y }); }
      addFx(state, { k: 'r', x: c.x, y: c.y, r: R, c: m.el ? ELEMENTS[m.el].color : '#eeeeee', t: 0.3, life: 0.3 });
      return;
    }
    const range = Math.max(220, Math.min(460, W.speed * W.life));
    const tg = nearest(alive, mx, my, range);
    if (!tg) return;
    m.cd = W.cd * KEEP.mountCd;
    m.a = Math.atan2(tg.y - my, tg.x - mx);
    const n = (W.pellets || 1) * (W.barrels?.length || 1), spread = W.spread || 0.16;
    for (let k = 0; k < n; k++) {
      const a = m.a + (n > 1 ? (k / (n - 1) - 0.5) * spread : 0) + (Math.random() - 0.5) * (W.inacc || 0);
      state.bullets.push({
        id: state.nextId++, owner: 'p', shooter: null, kind: m.k, fam: W.fam, x: mx, y: my,
        vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, r: W.fam === 'bow' ? 5 : 4, dmg: W.dmg * mul * (n > 1 ? 0.7 : 1),
        life: W.life, pierce: W.pierce || 0, bounce: 0, blast: W.blast || 0, hits: [], el: m.el, elv: m.lv,
      });
    }
  });
}

// 군단 소환 (4~7 키): 팀 골드를 써서 성 옆에 유닛을 부름
// 군단: 준비 단계엔 훈련소(기본 병력, 살아남으면 계속 남음), 전투 중엔 쿨타임 지원 소환(그 라운드만)
const barracksLv = (p) => p.build?.keep?.bk || 1;
const armyCap = (p) => BARRACKS.cap(barracksLv(p)) + (p.bb?.armyCap || 0);
const supportCdOf = (p, k) => Math.max(2, BARRACKS.supportCd[k] * BARRACKS.cdMul(barracksLv(p)) * (1 - (p.bb?.summon || 0) - (p.guild ? guildPerks(p.guild.lv).summon : 0)));
const trainedOf = (state, p) => state.units.filter((u) => u.owner === p.id && !u.temp && u.hp > 0).length;

function summonUnit(state, p, idx) {
  const c = state.castle;
  const k = p.army?.sel?.[idx];
  if (!c || !k || !UNITS[k]) return;
  const U = UNITS[k];
  if (state.campPhase !== 'fight') {
    // 훈련소: 대기열에 넣으면 차례로 훈련됨
    if (trainedOf(state, p) + p.trainQ.length >= armyCap(p)) { floatText(state, p.x, p.y - 34, `훈련소가 가득 찼어요 (${armyCap(p)})`, '#ffcc80', 0.9); return; }
    p.trainQ.push(k);
    floatText(state, p.x, p.y - 34, `${U.name} 훈련 대기 (${p.trainQ.length})`, '#90caf9', 0.8);
    return;
  }
  // 지원 소환: 쿨타임마다
  if ((p.sumCd[k] || 0) > 0) { floatText(state, p.x, p.y - 34, `${U.name} 지원 ${Math.ceil(p.sumCd[k])}초 남음`, '#ffcc80', 0.8); return; }
  if (state.units.filter((u) => u.owner === p.id && u.temp && u.hp > 0).length >= BARRACKS.supportMax) { floatText(state, p.x, p.y - 34, '지원 병력이 가득 찼어요', '#ffcc80', 0.9); return; }
  p.sumCd[k] = supportCdOf(p, k);
  spawnUnit(state, p, k, true);
}

function spawnUnit(state, p, k, temp) {
  const c = state.castle, U = UNITS[k];
  const lv = p.army.lv?.[k] || 1, sc = unitScale(lv);
  const a = Math.random() * Math.PI * 2;
  const spot = freeSpotNear(state, c.x + Math.cos(a) * 60, c.y + Math.sin(a) * 60);
  const hp = Math.round(U.hp * sc * (1 + (p.bb?.unitHp || 0)) * 10) / 10;
  state.units.push({
    id: state.nextId++, kind: k, owner: p.id, x: spot.x, y: spot.y, r: U.r, hp, maxHp: hp, lv, temp: !!temp,
    dmg: U.dmg * sc * (1 + (p.bb?.unitDmg || 0)), heal: (U.heal || 0) * sc, cd: 0.5, face: 1, atkT: 0,
    guard: Math.random() * Math.PI * 2, hitT: 0,
  });
  addFx(state, { k: 'r', x: spot.x, y: spot.y, r: 20, c: temp ? '#ffd54f' : '#90caf9', t: 0.3, life: 0.3 });
}

// 준비 단계: 훈련 대기열 진행 / 전투 중: 지원 소환 쿨타임
function updateArmy(state, players, dt) {
  for (const p of players) {
    if (state.campPhase === 'fight') {
      for (const k in p.sumCd) p.sumCd[k] = Math.max(0, p.sumCd[k] - dt);
      continue;
    }
    if (!p.trainQ.length) { p.trainT = 0; continue; }
    p.trainT += dt;
    const k = p.trainQ[0];
    if (p.trainT >= BARRACKS.trainTime(k)) {
      p.trainT = 0;
      p.trainQ.shift();
      if (trainedOf(state, p) < armyCap(p)) spawnUnit(state, p, k, false);
    }
  }
}

// 라운드가 끝나면(이기든 지든): 지원 병력은 돌아가고, 기본 병력은 회복. 상점·일시 강화 초기화
function resetRoundArmy(state, players) {
  state.units = state.units.filter((u) => !u.temp && u.hp > 0);
  for (const u of state.units) u.hp = u.maxHp;
  for (const p of players) p.sumCd = {};
  state.rally = false;
  state.volley = false;
  setupCampShop(state);
}

// 캠프 상점: 성 아래쪽 진열대 (팀 골드)
function setupCampShop(state) {
  const c = state.castle;
  if (!c) return;
  state.shop = CAMP_SHOP.map((kind, i) => ({
    id: state.nextId++, kind, gold: true, price: SHOP[kind].price,
    x: c.x + (i - (CAMP_SHOP.length - 1) / 2) * 64, y: c.y + 160, sold: false,
  }));
}

function damageUnit(state, u, dmg) {
  if (u.hp <= 0) return;
  u.hp -= dmg;
  u.hitT = 0.12;
  if (u.hp <= 0) addFx(state, { k: 'r', x: u.x, y: u.y, r: 16, c: '#b0bec5', t: 0.35, life: 0.35 });
}

function updateUnits(state, dt) {
  const c = state.castle;
  if (!c) return;
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    const U = UNITS[u.kind];
    u.cd -= dt;
    u.hitT = Math.max(0, u.hitT - dt);
    u.atkT = Math.max(0, u.atkT - dt);
    // 성직자: 다친 아군(유닛·플레이어·성) 회복
    if (U.heal) {
      if (u.cd <= 0) {
        const hurt = [...state.units.filter((o) => o.hp > 0 && o.hp < o.maxHp), ...Object.values(state.players).filter((p) => p.alive && p.hp < maxHpOf(p))]
          .filter((o) => Math.hypot(o.x - u.x, o.y - u.y) < U.range);
        const castleHurt = c.hp < c.maxHp && Math.hypot(c.x - u.x, c.y - u.y) < U.range + c.r;
        if (hurt.length || castleHurt) {
          u.cd = U.cd;
          u.atkT = 0.3;
          const t = hurt.sort((a, b) => a.hp / (a.maxHp || 1) - b.hp / (b.maxHp || 1))[0];
          if (t && t.kind) t.hp = Math.min(t.maxHp, t.hp + 2 * u.heal);
          else if (t) { if ((t.priestT || 0) <= state.time) { heal(t, 1); t.priestT = state.time + 6; } }
          if (castleHurt) c.hp = Math.min(c.maxHp, c.hp + u.heal);
          const tx = t ? t.x : c.x, ty = t ? t.y : c.y;
          addFx(state, { k: 'l', x: u.x, y: u.y - 10, x2: tx, y2: ty, c: '#fff59d', t: 0.25, life: 0.25 });
        }
      }
    }
    // 목표: 성 근처의 가장 가까운 적
    const target = U.heal ? null : nearest(state.enemies.filter((e) => e.hp > 0 && !e.air && Math.hypot(e.x - c.x, e.y - c.y) < 460), u.x, u.y, 320);
    let mx = 0, my = 0;
    if (target) {
      const dx = target.x - u.x, dy = target.y - u.y, d = Math.hypot(dx, dy) || 1;
      u.face = dx < 0 ? -1 : 1;
      if (d > U.range + target.r) { mx = dx / d; my = dy / d; }
      else if (u.cd <= 0) {
        u.cd = U.cd;
        u.atkT = 0.2;
        const src = state.players[u.owner] ? u.owner : null;
        if (U.range > 40) {
          // 원거리: 궁수 화살 / 마법사 폭발탄
          const a = Math.atan2(dy, dx);
          state.bullets.push({
            id: state.nextId++, owner: 'p', shooter: src, kind: U.splash ? 'unitBolt' : 'bow', fam: U.splash ? null : 'bow', x: u.x, y: u.y - 6,
            vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, r: U.splash ? 6 : 4, dmg: u.dmg * (state.rally ? 1.3 : 1), life: 0.8, pierce: 0, bounce: 0, hits: [],
            el: null, elv: 0, blast: U.splash || 0,
          });
        } else {
          damageEnemy(state, target, u.dmg * (state.rally ? 1.3 : 1), src);
          if (target.hp > 0) push(state, target, dx / d, dy / d, 6);
        }
      }
    } else {
      // 할 일이 없으면 성 주위 제자리로
      const gx = c.x + Math.cos(u.guard) * 70, gy = c.y + Math.sin(u.guard) * 70;
      const dx = gx - u.x, dy = gy - u.y, d = Math.hypot(dx, dy);
      if (d > 12) { mx = dx / d; my = dy / d; u.face = dx < 0 ? -1 : 1; }
    }
    const sp = U.speed * dt;
    if (mx || my) moveCircle(state, u, mx * sp, my * sp, false);
  }
  // 유닛끼리 겹치지 않게
  const list = state.units;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d > 0 && d < min) {
        const k = (min - d) / 2;
        moveCircle(state, a, (-dx / d) * k, (-dy / d) * k, false);
        moveCircle(state, b, (dx / d) * k, (dy / d) * k, false);
      }
    }
  }
  state.units = state.units.filter((u) => u.hp > 0);
}

// 적의 목표: 가까운(160px) 플레이어·유닛 → 없으면 성. 성이 없는 모드는 가장 가까운 플레이어
function enemyTarget(state, e, alivePlayers) {
  if (!state.castle) return nearest(alivePlayers, e.x, e.y);
  const near = nearest([...alivePlayers, ...state.units], e.x, e.y, 160);
  return near || state.castle;
}

// 적이 목표에 부딪혔을 때 피해 (플레이어·유닛·성)
function hitTarget(state, t, dmg) {
  if (t === state.castle) damageCastle(state, dmg * 0.6); // 성은 단단해서 피해 60%
  else if (t.kind && UNITS[t.kind]) damageUnit(state, t, dmg * 1.5);
  else damagePlayer(state, t, dmg);
}

// ---------- 베이스캠프 = 생존 모드 (탕탕특공대 방식) ----------
// 적이 끊임없이 몰려오고, 레벨업 카드로 자동 스킬·패시브를 모아 조합 진화합니다.

// 화면 바깥(플레이어 기준 520~720px)의 바닥에서 적이 나옴
function campSpawnPoint(state) {
  const m = state.map, camp = m.camp;
  const alive = Object.values(state.players).filter((p) => p.alive);
  const ref = alive[Math.floor(Math.random() * alive.length)] || camp;
  for (let tries = 0; tries < 30; tries++) {
    const a = Math.random() * Math.PI * 2, d = 520 + Math.random() * 200;
    const x = ref.x + Math.cos(a) * d, y = ref.y + Math.sin(a) * d;
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (circleBlocked(state, tileCenter(tx), tileCenter(ty), 26, false) || Math.hypot(x - camp.x, y - camp.y) < camp.r + TILE * 2) continue; // 큰 적도 벽에 안 박히게
    if (alive.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 400 ** 2)) continue;
    return { x: tileCenter(tx), y: tileCenter(ty) };
  }
  for (let tries = 0; tries < 100; tries++) {
    const tx = 1 + Math.floor(Math.random() * (m.cols - 2)), ty = 1 + Math.floor(Math.random() * (m.rows - 2));
    if (!circleBlocked(state, tileCenter(tx), tileCenter(ty), 26, false) && Math.hypot(tileCenter(tx) - camp.x, tileCenter(ty) - camp.y) > camp.r + TILE * 3) return { x: tileCenter(tx), y: tileCenter(ty) };
  }
  return { x: tileCenter(2), y: tileCenter(2) };
}

function spawnCampEnemy(state, kind) {
  if (kind === 'totem') kind = 'caster'; // 움직이지 않는 토템은 성까지 못 와서 라운드가 안 끝남
  const { x, y } = campSpawnPoint(state);
  const e = makeEnemy(state, kind, x, y, ROUND.level(state.round));
  if (kind !== 'boss') { e.hp = e.maxHp = Math.round(e.maxHp * SURVIVAL.hpMul * 10) / 10; }
  e.sc = { ...e.sc, dmg: ROUND.dmg(state.round) };
  state.enemies.push(e);
  return e;
}

function updateCamp(state, players, dt) {
  const S = SURVIVAL;
  const alive = players.filter((p) => p.alive);
  updateArmy(state, players, dt);
  // 준비 단계: 시간이 흘러도 시작하지 않음. 모두 G(준비)를 누르면 이번 라운드 시작
  if (state.campPhase === 'prep') {
    if (!(alive.length && alive.every((p) => p.ready))) return;
    for (const p of players) p.ready = false;
    startRound(state);
    return;
  }
  state.survT += dt;
  // 쓰러진 팀원은 20초 뒤 캠프에서 부활 (라운드가 끝나도 부활)
  for (const p of players) {
    if (p.alive) continue;
    p.reviveT = (p.reviveT ?? S.reviveTime) - dt;
    if (p.reviveT <= 0) { p.reviveT = S.reviveTime; revive(state, p, 0.5, freeSpotNear(state, state.map.spawn.x, state.map.spawn.y)); }
  }
  // 이번 라운드 적을 차례로 내보냄
  if (state.toSpawn > 0) {
    state.spawnT -= dt;
    if (state.spawnT <= 0 && state.enemies.length < S.maxEnemies) {
      state.spawnT = ROUND.spawnGap(state.round) / (1 + 0.25 * (players.length - 1));
      const batch = Math.min(state.toSpawn, 1 + Math.floor(state.round / 12) + (Math.random() < 0.1 ? 3 : 0));
      for (let i = 0; i < batch; i++) spawnCampEnemy(state, pickKind(1 + ROUND.level(state.round) * 2));
      state.toSpawn -= batch;
    }
    return;
  }
  if (state.enemies.length === 0) roundCleared(state, players);
}

function startRound(state) {
  const r = state.round, players = Object.values(state.players);
  state.campPhase = 'fight';
  state.survT = 0;
  state.roundBoss = r % ROUND.bossEvery === 0;
  state.toSpawn = state.roundBoss ? Math.ceil(ROUND.count(r) / 2) : ROUND.count(r);
  state.spawnT = 0.5;
  const c = state.map.camp;
  floatText(state, c.x, c.y - 90, `라운드 ${r} 시작!`, '#ff8a80', 2);
  if (r % ROUND.eliteEvery === 0) {
    const e = spawnCampEnemy(state, 'elite');
    e.hp = e.maxHp = Math.round(ENEMY_TYPES.elite.hp * (1 + 0.12 * r) * (1 + 0.5 * (players.length - 1)));
  }
  if (state.roundBoss) {
    const m = state.map;
    const room = { x0: 1, y0: 1, w: m.cols - 2, h: m.rows - 2 };
    const spot = campSpawnPoint(state);
    spawnBoss(state, { ...room, x0: Math.floor(spot.x / TILE) - 12, y0: Math.floor(spot.y / TILE) - 3, w: 24 });
    const boss = state.enemies[state.enemies.length - 1];
    boss.room = room;
    boss.x = spot.x; boss.y = spot.y;
    boss.hp = boss.maxHp = Math.round(boss.maxHp * (1 + 0.15 * (r / ROUND.bossEvery - 1)));
    floatText(state, c.x, c.y - 60, '보스 라운드!', '#ffab40', 2);
  }
}

// 라운드 클리어: 보상 + 다음 라운드 (방장 저장에 기록), 성 체력 회복, 쓰러진 팀원 부활
function roundCleared(state, players) {
  const r = state.round;
  state.gold += ROUND.gold(r);
  giveEssence(state, ROUND.essence(r));
  for (const p of players) {
    p.spoils += ROUND.spoils(r);
    if (r % ROUND.bossEvery === 0) p.crowns += 1;
    if (!p.alive) revive(state, p, 1, freeSpotNear(state, state.map.spawn.x, state.map.spawn.y));
    p.reviveT = SURVIVAL.reviveTime;
  }
  state.clears++;
  state.round++;
  state.campPhase = 'prep';
  resetRoundArmy(state, players);
  state.hazards = [];
  if (state.castle) state.castle.hp = state.castle.maxHp;
  const c = state.map.camp;
  floatText(state, c.x, c.y - 90, `라운드 ${r} 클리어! 골드 +${ROUND.gold(r)}${r % ROUND.bossEvery === 0 ? ' · 왕관 +1' : ''}`, '#a5d6a7', 2.4);
}

// 패배: 판이 끝나지 않고 같은 라운드 준비 단계로 돌아감 (성 키우기처럼)
function campDefeat(state, why) {
  state.defeats++;
  state.campPhase = 'prep';
  resetRoundArmy(state, Object.values(state.players));
  state.toSpawn = 0;
  state.enemies = [];
  state.hazards = [];
  state.bullets = state.bullets.filter((b) => b.owner !== 'e');
  if (state.castle) state.castle.hp = state.castle.maxHp;
  for (const p of Object.values(state.players)) {
    if (!p.alive) revive(state, p, 1, freeSpotNear(state, state.map.spawn.x, state.map.spawn.y));
    p.reviveT = SURVIVAL.reviveTime;
    p.ready = false;
  }
  const c = state.map.camp;
  floatText(state, c.x, c.y - 90, `${why} 라운드 ${state.round}에 다시 도전`, '#ff8a80', 2.6);
}

// ---------- 모험 모드: 방 / 포털 / 스테이지 ----------
// 전투 중: 스킬 쿨타임·시간형 궁극기가 이때만 찹니다.
function inCombat(state) {
  if (state.phase !== 'playing') return false;
  return state.mode === 'camp' ? state.enemies.length > 0 : !!state.activeRoom;
}

function roomAt(state, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return state.map.rooms.find((r) => tx >= r.x0 + 1 && tx <= r.x0 + r.w - 2 && ty >= r.y0 + 1 && ty <= r.y0 + r.h - 2) || null;
}

// 방과 점 사이 거리 (타일 단위)
function distToRoom(r, x, y) {
  const tx = x / TILE, ty = y / TILE;
  const dx = Math.max(r.x0 - tx, 0, tx - (r.x0 + r.w));
  const dy = Math.max(r.y0 - ty, 0, ty - (r.y0 + r.h));
  return Math.hypot(dx, dy);
}

// 미니맵: 복도를 절반 이상 건너야 다음 방이 보입니다.
function revealByCorridor(state, p) {
  const rooms = state.map.rooms;
  for (const r of rooms) {
    if (r.seen) continue;
    for (const id of r.links) {
      const a = rooms[id];
      const dr = distToRoom(r, p.x, p.y), da = distToRoom(a, p.x, p.y);
      const gap = Math.max(Math.abs(a.gx - r.gx) ? Math.abs((a.x0 + a.w / 2) - (r.x0 + r.w / 2)) - (a.w + r.w) / 2 : Math.abs((a.y0 + a.h / 2) - (r.y0 + r.h / 2)) - (a.h + r.h) / 2, 1);
      if (dr <= da && dr + da <= gap + 3) { r.seen = true; break; }
    }
  }
}

// 다음 웨이브가 나올 자리를 미리 고름 (조준경 표시용)
const WAVE_WARN = 1.6;
function planRoomWave(state, room) {
  const idx = state.stageIdx;
  const alive = Object.values(state.players).filter((p) => p.alive);
  const count = Math.min(4 + Math.floor(idx * 0.7) + Math.max(0, alive.length - 1) * 2, 20);
  const spots = [];
  for (let i = 0; i < count; i++) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 60; tries++) {
      const tx = room.x0 + 1 + Math.floor(Math.random() * (room.w - 2));
      const ty = room.y0 + 1 + Math.floor(Math.random() * (room.h - 2));
      if (isWallTile(state, tx, ty)) continue;
      x = tileCenter(tx); y = tileCenter(ty);
      if (alive.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > 150 ** 2) && spots.every((o) => (o.x - x) ** 2 + (o.y - y) ** 2 > 24 ** 2)) break;
    }
    if (x) spots.push({ x, y });
  }
  return spots;
}

function spawnRoomWave(state, room, spots = planRoomWave(state, room)) {
  room.wavesLeft--;
  const idx = state.stageIdx;
  for (const { x, y } of spots) {
    state.enemies.push(makeEnemy(state, pickKind(1 + idx), x, y, idx));
    addFx(state, { k: 'r', x, y, r: 18, c: '#ef5350', t: 0.3, life: 0.3 });
  }
  room.plan = null;
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
  if (room.type === 'boss') {
    room.wavesLeft = 0;
    room.waveDelay = 1.5;
    spawnBoss(state, room);
    return;
  }
  const idx = state.stageIdx;
  room.wavesLeft = 1 + (idx >= 2 ? 1 : 0) + (idx >= 8 ? 1 : 0);
  spawnRoomWave(state, room);
}

function clearRoom(state, room) {
  room.state = 'cleared';
  state.activeRoom = null;
  state.doorSet = new Set();
  const alive = Object.values(state.players).filter((p) => p.alive);
  const boss = room.type === 'boss';
  floatText(state, alive[0]?.x ?? 0, (alive[0]?.y ?? 0) - 30, boss ? '보스 처치! 왕관 +1' : '방 클리어!', boss ? '#ffd54f' : '#a5d6a7', 1.6);
  if (boss) for (const p of Object.values(state.players)) { p.crowns += 1; giveTreasure(state, p); }
  for (const p of Object.values(state.players)) if (!p.alive && alive[0]) revive(state, p, 0.5, alive[0]);
  for (const p of alive) if (hasPerk(p, 'tide')) heal(p, 1);
  giveEssence(state, ESSENCE.room);
  // 보물상자: 보스방은 반드시, 일반 방은 가끔 (상자방이 따로 있음)
  if (boss || Math.random() < 0.2) {
    const cx = (room.x0 + room.w / 2) * TILE, cy = (room.y0 + room.h / 2) * TILE;
    spawnChest(state, cx + (boss ? 80 : 0), cy);
  }
}

function updateAdventure(state, players, dt) {
  const alive = players.filter((p) => p.alive);
  for (const p of alive) {
    const r = roomAt(state, p.x, p.y);
    if (r) { r.seen = true; r.visited = true; continue; }
    revealByCorridor(state, p);
  }

  const room = state.activeRoom;
  if (room) {
    if (state.enemies.length > 0) return;
    // 웨이브 사이: 다음 몬스터가 나올 자리를 조준경으로 먼저 보여 줌
    if (room.wavesLeft > 0 && !room.plan) { room.plan = planRoomWave(state, room); room.waveDelay = Math.max(room.waveDelay, WAVE_WARN); }
    room.waveDelay -= dt;
    if (room.waveDelay > 0) return;
    if (room.wavesLeft > 0) spawnRoomWave(state, room, room.plan || undefined);
    else clearRoom(state, room);
    return;
  }

  for (const p of alive) {
    const r = roomAt(state, p.x, p.y);
    if (r && (r.type === 'battle' || r.type === 'boss') && r.state !== 'cleared') { activateRoom(state, r, p); return; }
  }

  // 포털: 살아 있는 팀원 전원이 포털 위에 모여야 출발 (보스 스테이지는 보스를 잡아야 열림)
  if (state.map.boss && !state.map.rooms.some((r) => r.type === 'boss' && r.state === 'cleared')) return;
  const portal = state.map.portal;
  const onPortal = alive.length > 0 && alive.every((p) => Math.hypot(p.x - portal.x, p.y - portal.y) < PORTAL_RANGE);
  state.portalT = onPortal ? state.portalT + dt : 0;
  if (state.portalT >= 1) beginTransition(state);
}

function beginTransition(state) {
  state.phase = 'transition';
  state.transT = TRANSITION_TIME;
  state.portalT = 0;
  giveEssence(state, ESSENCE.stage);
  Object.assign(state, { enemies: [], bullets: [], orbs: [], fx: [], grenades: [], zones: [], chests: [], pickups: [], shop: [], hazards: [] });
  for (const p of Object.values(state.players)) {
    p.reward = makeReward(p);
    p.rewardDone = false;
    // 들고 있는 무기의 다음 진화 (diep.io 탱크처럼 갈래 중 하나, 안 해도 됨)
    const W = WEAPONS[held(p).key];
    p.evo = W.evo ? [...W.evo] : null;
    p.evoDone = !p.evo;
    p.ultT = 0;
    p.sdash = null;
    p.javelin = null;
  }
}

function updateTransition(state, players, dt) {
  state.transT -= dt;
  if (state.transT > 0 && !players.every((p) => p.rewardDone && p.evoDone)) return;
  for (const p of players) {
    if (!p.rewardDone && p.reward?.[0]) applyReward(p, p.reward[0]);
    Object.assign(p, { reward: null, rewardDone: false, evo: null, evoDone: true });
  }
  state.stageIdx++;
  if (state.stageIdx >= WORLDS * STAGES_PER_WORLD) {
    endRun(state, '던전 정복! 🎉');
    return;
  }
  state.map = generateDungeon(state.stageIdx, { boss: isBossStage(state.stageIdx) });
  state.doorSet = new Set();
  state.activeRoom = null;
  state.chestsThisStage = 0;
  setupStageRooms(state);
  loadTraps(state);
  state.phase = 'playing';
  players.forEach((p, i) => {
    if (!p.alive) revive(state, p, 0.5);
    placeAtSpawn(state, p, i);
  });
}

function updateEffects(state, players, dt) {
  for (const f of state.fx) f.t -= dt;
  state.fx = state.fx.filter((f) => f.t > 0);
  const ids = players.map((p) => p.id);
  for (const o of state.orbs) o.t -= dt;
  state.orbs = state.orbs.filter((o) => o.t > 0 && !ids.every((id) => o.taken.includes(id)));
}

// ---------- 한 틱 ----------
export function step(state, inputs, dt) {
  state.time += dt;
  const players = Object.values(state.players);
  for (const p of players) updatePlayer(state, p, inputs[p.id] || EMPTY_INPUT, dt);

  if (state.phase === 'lobby') {
    updateBullets(state, dt);
    updateEffects(state, players, dt);
    if (state.phase === 'lobby') updateLobby(state, players, dt);
    return;
  }
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
  if (state.castle) { updateCastle(state, dt); updateUnits(state, dt); }
  updateBullets(state, dt);
  updateHazards(state, dt);
  updateTraps(state, dt);
  updateGrenadesAndZones(state, dt);
  // 총알·스킬·지속 피해·반응 어떤 이유로든 쓰러진 적은 마지막으로 때린 사람에게 점수를 줍니다.
  for (const e of state.enemies) if (e.hp <= 0) killEnemy(state, e);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  updateEffects(state, players, dt);

  if (players.length === 0) return;
  if (!players.some((p) => p.alive)) {
    if (state.mode === 'camp') campDefeat(state, '전멸!');
    else endRun(state, `전멸! (${stageLabel(state.stageIdx)})`);
    return;
  }
  if (state.mode === 'camp') updateCamp(state, players, dt);
  else updateAdventure(state, players, dt);
}

const fmtTime = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;

// ---------- 스냅샷 ----------
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

function statusCode(s) {
  return (s.burn > 0 ? 'b' : '') + (s.wet > 0 ? 'w' : '') + (s.chill > 0 ? 'c' : '')
    + (s.frozen > 0 ? 'f' : '') + (s.poison > 0 ? 'p' : '') + (s.stun > 0 ? 'z' : '');
}

// 미니맵: '-' 모름 · 'k' 길은 알지만 안 가 본 방(회색) · 's' 보임(종류 표시) · 'v' 가 봄 · 'c' 클리어 · 'a' 전투 중
function roomCode(r, rooms) {
  if (r.state === 'active') return 'a';
  if (r.state === 'cleared') return 'c';
  if (r.visited) return r.type === 'battle' || r.type === 'boss' ? 's' : 'v';
  if (r.seen) return 's';
  return r.links.some((id) => rooms[id].visited) ? 'k' : '-';
}

function bulletSnap(b) {
  return {
    x: r1(b.x), y: r1(b.y), r: b.r, o: b.owner === 'p' ? 0 : 1, el: b.el || 0, k: b.kind || 0,
    a: b.kind === 'turret' ? 0 : r2(Math.atan2(b.vy, b.vx)), st: b.stuck ? 1 : 0,
  };
}

// HUD에 보여 줄 지금 무기의 실제 수치
function weaponStats(p) {
  const st = stats(p);
  return {
    d: Math.round(st.dmg * 10) / 10,
    a: Math.round((1 / Math.max(0.05, st.cd)) * 10) / 10,
    c: Math.round(st.crit * 100),
    x: st.critX,
    h: st.W.kind === 'ranged' ? Math.max(0, Math.round(100 - st.inacc * 150)) : 100,
    m: st.W.mana || 0,
    ch: st.W.charge || 0,
  };
}

// 화면에 그릴 데이터만 추린 가벼운 사본 (네트워크 전송용)
export function snapshot(state) {
  const boss = state.enemies.find((e) => e.kind === 'boss');
  const bossRoom = state.map.rooms?.find((r) => r.type === 'boss');
  return {
    ph: state.phase,
    md: state.mode,
    rid: state.runId,
    hid: state.hostId,
    mid: state.map.id,
    lp: state.phase === 'lobby' ? lobbyProblem(state) : null,
    lpt: state.lobbyPortal ? { m: state.lobbyPortal, t: r1(state.lobbyPortalT) } : null,
    si: state.stageIdx,
    rs: state.map.rooms.map((r) => roomCode(r, state.map.rooms)).join(''),
    ar: state.activeRoom ? state.activeRoom.id : -1,
    pt: r1(state.portalT),
    po: !state.map.boss || bossRoom?.state === 'cleared' ? 1 : 0,
    bs: boss ? { n: boss.name, hp: boss.hp, mh: boss.maxHp } : null,
    tt: Math.ceil(state.transT),
    ot: state.overText,
    w: state.wave,
    wt: r1(Math.max(0, state.waveTimer)),
    tm: r2(state.time),
    ca: state.castle ? { x: state.castle.x, y: state.castle.y, hp: Math.ceil(state.castle.hp), mh: state.castle.maxHp, lv: state.castle.lv, h: state.castle.hitT > 0 ? 1 : 0, mt: (state.castle.mounts || []).map((m) => [m.k, r2(m.a), m.el || 0]) } : null,
    un: (() => {
      const ids = Object.keys(state.players);
      return state.units.map((u) => [u.id, u.kind, Math.round(u.x), Math.round(u.y), Math.round((u.hp / u.maxHp) * 100), ids.indexOf(u.owner), u.face, u.atkT > 0 ? 1 : 0, u.hitT > 0 ? 1 : 0]);
    })(),
    sv: state.mode === 'camp' ? { r: state.round, f: state.campPhase === 'fight' ? 1 : 0, k: state.kills || 0, left: (state.toSpawn || 0) + state.enemies.length, b: state.roundBoss ? 1 : 0, cl: state.clears || 0, df: state.defeats || 0 } : null,
    br: state.barrels.filter((b) => b.hp > 0).map((b) => b.id),
    g: state.gold,
    p: Object.values(state.players).map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y),
      a: r2(p.angle), hp: p.hp, mh: maxHpOf(p),
      al: p.alive ? 1 : 0, s: p.score, iv: p.invuln > 0 ? 1 : 0, mv: p.moving ? 1 : 0, ds: p.dashT > 0 || p.sdash ? 1 : 0,
      bf: p.buffs, at: p.augTypes.length, of: p.offer, oq: p.offerQueue, rd: p.ready ? 1 : 0,
      el: p.element, elv: p.elementLv, pz: p.paused ? 1 : 0, cr: p.char, co: Math.floor(p.coins),
      sh: p.char === 'knight' && p.shieldT <= 0 ? 1 : 0, dx: r1(p.dsx), dy: r1(p.dsy),
      lv: p.level, xp: Math.floor(p.xp), xn: xpToNext(p.level), es: Math.floor(p.es),
      rw: p.reward, rwd: p.rewardDone ? 1 : 0, ev: p.evo, evd: p.evoDone ? 1 : 0,
      ws: p.weapons.map((s) => ({
        k: s.key, el: s.el, lv: s.elv, u: Math.floor((s.ult / SKILLS[weaponFam(s.key)].ult.need) * 100),
        cd: r1(Math.max(0, s.cd)), c: s.charges, cm: WEAPONS[s.key].charges || 1,
      })),
      sl: p.slot, sw: r1(p.swapCd), ut: r1(p.ultT), cb: inCombat(state) ? 1 : 0,
      jv: p.javelin ? 1 : 0, ld: p.loadout, pp: p.perkIds || [], cs: p.casts.map(r1), sgt: r2(p.swingT / SWING_TIME), sgd: p.swingDir,
      cg: p.chargeT > 0 && WEAPONS[held(p)?.key]?.charge ? r2(Math.min(1.5, p.chargeT / WEAPONS[held(p).key].charge)) : 0, cw: p.crowns, tr: p.trRun?.length ? p.trRun : 0, gd: p.guild ? [p.guild.name, p.guild.color] : 0, uc: state.castle ? trainedOf(state, p) + (p.trainQ?.length || 0) : 0, ucap: armyCap(p),
      ar: (p.army?.sel || []).map((k) => [k, r1(p.sumCd?.[k] || 0), r1(supportCdOf(p, k)), p.army.lv?.[k] || 1,
        state.units.filter((u) => u.owner === p.id && !u.temp && u.hp > 0 && u.kind === k).length, (p.trainQ || []).filter((q) => q === k).length]),
      tq: p.trainQ?.length ? [p.trainQ[0], r2(p.trainT / BARRACKS.trainTime(p.trainQ[0]))] : 0,
      sp: p.spoils, rv: p.alive ? 0 : Math.ceil(p.reviveT),
      mp: Math.floor(p.mana), mm: stats(p).maxMana, sk: p.skin, wst: weaponStats(p),
    })),
    e: state.enemies.map((e) => ({
      id: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), r: e.r,
      hp: e.hp, mh: e.maxHp, h: e.hitT > 0 ? 1 : 0, s: statusCode(e.st), c: e.color || 0, ch: e.act === 'charge' ? 1 : 0,
      f: r2(e.face || 0), fu: e.fuse > 0 ? 1 : 0, ai: e.air ? 1 : 0, w: e.world ?? 0,
    })),
    wm: state.activeRoom?.plan ? state.activeRoom.plan.map((o) => [Math.round(o.x), Math.round(o.y)]) : null,
    wmt: state.activeRoom?.plan ? r1(Math.max(0, state.activeRoom.waveDelay)) : 0,
    hz: state.hazards.map((h) => ({
      k: h.k, x: r1(h.x), y: r1(h.y), r: h.r || 0, a: r2(h.a || 0), len: h.len || 0, w: h.w || 0,
      p: r2(Math.min(1, h.t / h.warn)), on: h.t >= h.warn ? 1 : 0, c: h.c || 0,
    })),
    sh: state.shop.map((o) => ({ id: o.id, x: o.x, y: o.y, kd: o.kind, k: o.key || 0, el: o.el || 0, lv: o.elv || 0, pr: o.price, so: o.sold ? 1 : 0, gd: o.gold ? 1 : 0 })),
    st: state.structs.map((s) => ({
      id: s.id, k: s.kind, tx: s.tx, ty: s.ty, hp: s.hp, mh: s.maxHp,
      a: s.angle !== undefined ? r2(s.angle) : 0,
    })),
    b: [
      ...state.bullets.map(bulletSnap),
      ...state.grenades.map((g) => {
        const t = g.t / g.dur;
        if (g.kind === 'meteor') return { x: r1(g.sx + (g.tx - g.sx) * t), y: r1(g.sy + (g.ty - g.sy) * t), r: 14, o: 0, el: g.el, k: 'meteor', a: 0, tx: r1(g.tx), ty: r1(g.ty), rr: g.r };
        return { x: r1(g.sx + (g.tx - g.sx) * t), y: r1(g.sy + (g.ty - g.sy) * t - Math.sin(Math.PI * t) * 40), r: 5, o: 0, el: g.el || (g.kind === 'molotov' ? 'fire' : 0), k: 'grenade', a: 0 };
      }),
    ],
    zn: state.zones.map((z) => ({ k: z.kind, x: r1(z.x), y: r1(z.y), r: z.r, t: r1(z.t), el: z.el || 0 })),
    cs: state.chests.map((c) => ({ id: c.id, x: c.x, y: c.y, o: c.open ? 1 : 0, b: c.big ? 1 : 0 })),
    pk: state.pickups.map((o) => ({ id: o.id, x: r1(o.x), y: r1(o.y), k: o.key, el: o.el || 0, lv: o.elv || 0 })),
    // 구슬은 많아서 짧게: [id, 종류, x, y, 주운 사람 비트] (비트 순서 = p 목록 순서)
    xo: (() => {
      const ids = Object.keys(state.players);
      return state.orbs.map((o) => [o.id, o.k, Math.round(o.x), Math.round(o.y), o.taken.reduce((m, id) => m | (1 << Math.max(0, ids.indexOf(id))), 0)]);
    })(),
    fx: state.fx.map((f) => ({ ...f, x: r1(f.x), y: r1(f.y), t: r1(f.t) })),
  };
}

export { LOADOUT_SIZE };
