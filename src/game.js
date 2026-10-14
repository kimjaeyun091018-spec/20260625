// 게임 규칙과 시뮬레이션 (화면/네트워크 코드 없음)
// 멀티플레이에서는 방장(호스트)의 브라우저만 이 시뮬레이션을 돌리고,
// 참가자들은 입력만 보내고 결과(스냅샷)를 받아서 그립니다.
//
// 흐름: lobby(걸어 다니는 방: 무기 거치대·포털) → playing → (모험) transition(스테이지 보상·전직) → … → over → lobby

import {
  TILE, MAX_PLAYERS, WEAPONS, WEAPON_KEYS, weaponFam, SKILLS, WEAPON_SLOTS, SWAP_COOLDOWN, RESONANCE_ULT,
  CHEST_CHANCE, sameWeaponLimit, ENEMY_TYPES, STRUCTS, BUFFS, ELEMENTS, ELEMENT_MAX, ELEMENT_MAX_BONUS,
  MAX_AUGMENT_TYPES, STAGE_REWARDS, STAGES_PER_WORLD, WORLDS, ESSENCE, BOSSES, stageLabel, xpToNext,
} from './data.js';
import { buildCampMap, buildLobbyMap, generateDungeon, tileCenter } from './maps.js';
import { ACTIVES, PERKS, NODE, LOADOUT_SIZE, sanitizeBuild, buildBonus } from './tree.js';

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
const INTERACT_RANGE = 48;
const PORTAL_RANGE = 56;
const SWING_TIME = 0.18;

const ACTION_RE = /^(fence|turret|demolish|ready|skill|ult|swap|evoskip|evo[12]|cast[1-4]|pick[1-3]|reward[1-3])$/;

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
function runLists() {
  return {
    enemies: [], bullets: [], structs: [], structMap: new Map(), fx: [], orbs: [],
    grenades: [], zones: [], chests: [], pickups: [],
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
    map: buildLobbyMap(WEAPON_KEYS),
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
function newSlot(key, el = null) {
  return { key, el, ult: 0, cd: 0, charges: WEAPONS[key].charges || 1 };
}

const held = (p) => p.weapons[p.slot] || p.weapons[0];
const heldFam = (p) => weaponFam(held(p)?.key);
const skillCdOf = (key) => WEAPONS[key].skillCd || SKILLS[weaponFam(key)].skill.cd;
const maxHpOf = (p) => p.maxHp + (heldFam(p) === 'hammer' ? 2 : 0); // 해머 패시브: 강철 몸
const weaponSlotsOf = (p) => WEAPON_SLOTS + (p.bonus.slot ? 1 : 0);
const hasPerk = (p, k) => !!p?.perks?.includes(k);

// 공격에 붙는 속성: 무기 속성이 우선. 무기 속성 = 캐릭터 속성이면 공명(레벨 +1)
function attackElement(p) {
  const s = held(p);
  if (s?.el) {
    const resonance = s.el === p.element;
    return { el: s.el, elv: resonance ? Math.min(ELEMENT_MAX_BONUS + 1, p.elementLv + 1) : 1, resonance };
  }
  return { el: p.element, elv: p.elementLv, resonance: false };
}

// 궁극기 게이지 충전 (들고 있는 무기가 그 계열·방식일 때만)
function chargeUlt(p, fam, type, amount) {
  const s = held(p);
  if (!s || weaponFam(s.key) !== fam) return;
  const def = SKILLS[fam].ult;
  if (def.type !== type || p.ultT > 0) return;
  const mult = (attackElement(p).resonance ? RESONANCE_ULT : 1) * p.bonus.ultMul;
  s.ult = Math.min(def.need, s.ult + amount * mult);
}

// ---------- 플레이어 ----------
function usedColor(state, color) {
  return Object.values(state.players).some((p) => p.color === color);
}

function freshRunStats(p) {
  Object.assign(p, {
    hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, alive: true, score: 0, invuln: 1.5,
    fireCd: 0, dashCd: 0, dashT: 0, healT: 0, moving: false, es: 0,
    buffs: {}, augTypes: [], offer: null, offerQueue: 0, element: null, elementLv: 0,
    level: 1, xp: 0, ready: false, reward: null, rewardDone: false, evo: null, evoDone: true, rewardsTaken: [],
    bonus: { dmg: 0, rate: 0, speed: 0, xpMul: 1, iron: false, vamp: 0, slot: false, cdMul: 1, phoenix: false, essMul: 1, ultMul: 1 },
    weapons: [newSlot(p.weapon || 'gun')], slot: 0, swapCd: 0,
    parry: 0, markId: null, markN: 0, spin: 0, spinIdle: 0, chargeT: 0,
    sdash: null, dashHits: [], javelin: null, ultT: 0, ultTick: 0, ultStep: 0,
    loadout: [], casts: [0, 0, 0, 0], perks: [], staticT: 0, swingT: 0, swingDir: 1,
  });
}

// 로비 스킬 트리 빌드를 이번 판에 적용
function applyBuild(p) {
  const b = p.build || { el: null, eq: [], nodes: [] };
  const bb = buildBonus(b);
  p.maxHp += bb.hp;
  p.hp = p.maxHp;
  p.bonus.dmg += bb.dmg;
  p.bonus.speed += bb.speed;
  p.bonus.xpMul += bb.xp;
  p.bonus.essMul += bb.ess;
  p.bonus.cdMul *= 1 - bb.cd;
  if (b.el) {
    p.element = b.el;
    p.elementLv = 1 + bb.elLv;
  }
  p.loadout = [...b.eq];
  p.casts = [0, 0, 0, 0];
  p.perks = b.eq.filter((id) => NODE[id].kind === 'perk').map((id) => NODE[id].perk);
}

export function setBuild(state, id, build) {
  const p = state.players[id];
  if (p) p.build = sanitizeBuild(build);
}

export function addPlayer(state, id, name) {
  if (state.players[id]) return state.players[id];
  if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
  const color = PLAYER_COLORS.find((c) => !usedColor(state, c)) ?? PLAYER_COLORS[0];
  const p = {
    id, name: sanitizeName(name), color, x: 0, y: 0, r: PLAYER_RADIUS,
    angle: 0, weapon: null, lastSeq: 0, paused: false, dashX: 0, dashY: 0, build: null,
  };
  freshRunStats(p);
  // 게임 도중 들어오면 관전(쓰러진 상태)으로 시작해서 다음 부활 때 합류합니다.
  if (state.phase !== 'lobby') {
    p.weapon = pickFreeWeapon(state);
    p.weapons = [newSlot(p.weapon)];
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
  const s = held(p);
  const W = WEAPONS[s?.key] || WEAPONS.gun;
  const fam = W.fam;
  const gunUlt = fam === 'gun' && p.ultT > 0;
  const tail = hasPerk(p, 'tailwind');
  return {
    W, fam,
    dmg: W.dmg + (b.dmg || 0) + B.dmg,
    cd: W.cd / (1 + 0.25 * (b.rate || 0) + B.rate) / (1 + (fam === 'gun' ? p.spin : 0)) / (gunUlt ? 3 : 1),
    shots: 1 + (b.multi || 0),
    spread: gunUlt ? 0.3 : 0,
    speed: PLAYER_SPEED * (1 + 0.12 * (b.speed || 0) + B.speed + (tail ? 0.08 : 0)),
    pierce: (W.pierce || 0) + (b.pierce || 0),
    bounce: b.bounce || 0,
    reach: 1 + 0.2 * (b.reach || 0),
    dashCd: DASH_COOLDOWN * 0.75 ** (b.dash || 0) * (B.iron ? 0.7 : 1) * (tail ? 0.7 : 1),
    vamp: B.vamp,
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
  for (const p of Object.values(state.players)) p.es += amount * p.bonus.essMul;
}

// ---------- 증강 (레벨업) ----------
// 증강 종류는 한 판에 최대 5종류 (속성 카드도 1종류). 5종류를 채우면 가진 것만 레벨업 카드로 나옵니다.
function makeOffer(p) {
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
  let elements = Object.keys(ELEMENTS)
    .filter((k) => !(p.element === k && p.elementLv >= ELEMENT_MAX))
    .map((k) => `el:${k}`);
  if (full) elements = p.augTypes.includes('el') && p.element && p.elementLv < ELEMENT_MAX ? [`el:${p.element}`] : [];
  const offer = shuffle([...buffs, ...elements]).slice(0, 3);
  if (!p.element && elements.length && !offer.some((k) => k.startsWith('el:'))) {
    offer[offer.length - 1] = shuffle(elements)[0];
  }
  return offer.length ? offer : null;
}

function applyBuff(p, key) {
  const type = key.startsWith('el:') ? 'el' : key;
  if (!p.augTypes.includes(type)) p.augTypes.push(type);
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
    p.maxHp += 3;
    p.hp = maxHpOf(p);
  } else if (k === 'might') B.dmg += 2;
  else if (k === 'gale') { B.rate += 0.4; B.speed += 0.1; }
  else if (k === 'wisdom') B.xpMul += 0.5;
  else if (k === 'iron') B.iron = true;
  else if (k === 'vamp') B.vamp = 0.15;
  else if (k === 'slot') B.slot = true;
  else if (k === 'focus') B.cdMul *= 0.75;
  else if (k === 'phoenix') B.phoenix = true;
  else if (k === 'coin') B.essMul += 0.5;
  else if (k === 'surge') B.ultMul += 0.3;
}

function evolve(p, key) {
  const s = held(p);
  if (!s || !WEAPONS[s.key].evo?.includes(key)) return;
  s.key = key;
  s.charges = WEAPONS[key].charges || 1;
  s.cd = 0;
}

// ---------- 로비 ----------
export function lobbyProblem(state) {
  const players = Object.values(state.players);
  if (players.some((p) => !p.weapon)) return '모든 플레이어가 무기 거치대에서 무기를 골라야 해요.';
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

// 로비에서 E: 가까운 무기 거치대의 무기를 듭니다.
function lobbyInteract(state, p) {
  const rack = nearest(state.map.lobby.racks, p.x, p.y, INTERACT_RANGE + 8);
  if (!rack) return;
  const k = rack.key;
  if (p.weapon === k) return;
  const limit = sameWeaponLimit(Object.keys(state.players).length);
  if (weaponCount(state, k, p.id) >= limit) {
    floatText(state, rack.x, rack.y - 30, '다른 플레이어가 쓰는 중', '#ef9a9a', 1);
    return;
  }
  p.weapon = k;
  p.weapons = [newSlot(k)];
  p.slot = 0;
  floatText(state, p.x, p.y - 34, WEAPONS[k].name, '#ffd54f', 0.8);
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
  for (const p of Object.values(state.players)) { freshRunStats(p); applyBuild(p); }
  state.phase = 'playing';
  state.overText = '';
  if (state.mode === 'camp') {
    Object.assign(state, { gold: START_GOLD, wave: 0, waveTimer: FIRST_BREAK, cleared: true });
    state.map = buildCampMap();
  } else {
    state.stageIdx = 0;
    state.map = generateDungeon(0, { boss: isBossStage(0) });
  }
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
  state.map = buildLobbyMap(WEAPON_KEYS);
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

// ---------- 보물상자 & 무기 줍기 ----------
function spawnChest(state, x, y) {
  const spot = freeSpotNear(state, x, y);
  state.chests.push({ id: state.nextId++, x: spot.x, y: spot.y, open: false });
  state.chestsThisStage++;
}

function randomWeaponDrop() {
  const key = shuffle([...WEAPON_KEYS])[0];
  const el = Math.random() < 0.6 ? shuffle(Object.keys(ELEMENTS))[0] : null;
  return { key, el };
}

// E 키: 가까운 상자 열기 → 가까운 무기 줍기 (칸이 꽉 차면 들고 있는 무기와 바꿈)
function interact(state, p) {
  const chest = nearest(state.chests.filter((c) => !c.open), p.x, p.y, INTERACT_RANGE);
  if (chest) {
    chest.open = true;
    const drop = randomWeaponDrop();
    state.pickups.push({ id: state.nextId++, x: chest.x, y: chest.y + 26, ...drop });
    floatText(state, chest.x, chest.y - 18, '무기 획득!', '#ffd54f', 1);
    return;
  }
  const pk = nearest(state.pickups, p.x, p.y, INTERACT_RANGE);
  if (!pk) return;
  state.pickups = state.pickups.filter((o) => o !== pk);
  const slot = newSlot(pk.key, pk.el);
  if (p.weapons.length < weaponSlotsOf(p)) {
    p.weapons.push(slot);
    p.slot = p.weapons.length - 1;
  } else {
    const old = held(p);
    state.pickups.push({ id: state.nextId++, x: p.x, y: p.y + 10, key: old.key, el: old.el });
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
  if (!p.alive) return;
  if (act === 'skill') useSkill(state, p, inp);
  else if (act === 'ult') useUlt(state, p, inp);
  else if (act === 'swap') swapWeapon(p);
  else if (act.startsWith('cast')) castActive(state, p, Number(act[4]) - 1, inp);
  else if (state.mode !== 'camp') {
    if (act === 'fence') interact(state, p); // 모험 모드에서 E = 상호작용
  } else if (act === 'fence' || act === 'turret') {
    // 캠프에서도 상자·무기가 가까우면 E는 상호작용
    if (act === 'fence' && (nearest(state.chests.filter((c) => !c.open), p.x, p.y, INTERACT_RANGE) || nearest(state.pickups, p.x, p.y, INTERACT_RANGE))) interact(state, p);
    else build(state, p, act, inp.bx, inp.by);
  } else if (act === 'demolish') demolish(state, inp.bx, inp.by);
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

function shoot(state, p, st, power = 1) {
  const W = st.W;
  const speed = W.speed * (attackElement(p).el === 'wind' ? 1.3 : 1) * (W.charge ? 0.7 + 0.5 * power : 1);
  const pellets = W.pellets || 1;
  const total = st.shots * pellets;
  const spread = (W.spread || 0.16) + st.spread;
  for (let i = 0; i < total; i++) {
    const a = p.angle + (total > 1 ? (i / (total - 1) - 0.5) * spread * Math.max(1, total / 3) : 0) + (Math.random() - 0.5) * (0.06 + st.spread);
    let dmg = W.charge ? Math.round(st.dmg * (0.6 + 1.4 * power)) : st.dmg;
    let crit = false;
    if (W.crit && Math.random() < W.crit) { dmg *= 3; crit = true; }
    state.bullets.push(makeBullet(state, p, a, speed, {
      r: W.fam === 'bow' ? 5 : 4, dmg, crit,
      life: W.life * (W.charge ? 0.7 + 0.6 * power : 1),
      pierce: st.pierce + (W.charge && power > 0.8 ? 2 : 0), bounce: st.bounce, blast: W.blast || 0,
    }));
  }
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
function meleeHit(state, p, e, dmg, ux, uy, knock) {
  damageEnemy(state, e, dmg, p.id);
  staticChain(state, p, e);
  if (heldFam(p) === 'sword') chargeUlt(p, 'sword', 'stack', 1);
  if (e.hp > 0) {
    const W = WEAPONS[held(p).key];
    if (W.execute && e.kind !== 'boss' && e.hp <= e.maxHp * W.execute) {
      damageEnemy(state, e, e.hp, p.id);
      floatText(state, e.x, e.y - e.r - 6, '처형!', '#ef9a9a');
      return;
    }
    push(state, e, ux, uy, knock);
    const { el, elv } = attackElement(p);
    if (el) applyElement(state, e, { el, elv, shooter: p.id, vx: ux, vy: uy });
  }
}

function melee(state, p, st) {
  const W = st.W;
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  const color = ELEMENTS[attackElement(p).el]?.color || '#ffffff';
  let dmg = st.dmg;
  if (st.fam === 'sword' && p.parry > 0) { dmg += p.parry; p.parry = 0; } // 검 패시브: 반격 자세
  p.swingT = SWING_TIME;
  p.swingDir = -p.swingDir;

  if (W.kind === 'slam') {
    const cx = p.x + ax * W.reach * st.reach, cy = p.y + ay * W.reach * st.reach;
    const rad = W.radius * st.reach;
    addFx(state, { k: 'r', x: cx, y: cy, r: rad, c: color, t: 0.25, life: 0.25 });
    for (const e of state.enemies.filter((o) => o.hp > 0 && (o.x - cx) ** 2 + (o.y - cy) ** 2 <= (rad + o.r) ** 2)) {
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      meleeHit(state, p, e, dmg, (e.x - p.x) / d, (e.y - p.y) / d, W.knock);
    }
    if (W.quake) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        state.bullets.push({ ...makeBullet(state, p, a, 300, { kind: 'wave', dmg: Math.ceil(dmg / 2), life: 0.45, pierce: 3, r: 6 }), x: cx, y: cy });
      }
    }
    return;
  }

  const range = W.range * st.reach;
  // 휘두르기 이펙트: 검 계열은 초승달 베기, 창 계열은 찌르기 섬광 (할버드는 둘 다)
  if (st.fam === 'sword' || p.weapons[p.slot].key === 'halberd') {
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
    meleeHit(state, p, e, tip ? Math.ceil(dmg * 1.5) : dmg, (e.x - p.x) / (d || 1), (e.y - p.y) / (d || 1), W.knock);
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
  if (s.charges <= 0) return;
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
      meleeHit(state, p, e, Math.ceil(st.dmg * 1.5), (e.x - p.x) / d, (e.y - p.y) / d, 20);
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
    state.grenades.push({ id: state.nextId++, kind: 'grenade', sx: p.x, sy: p.y, tx: t.x, ty: t.y, t: 0, dur: 0.8, src: p.id, dmg: 3 + st.dmg, r: 80, el, elv });
  }
}

// ---------- 스킬 트리 액티브 스킬 (1~4) ----------
function castActive(state, p, idx, inp) {
  const id = p.loadout[idx];
  const node = NODE[id];
  if (!node || node.kind !== 'active' || p.casts[idx] > 0) return;
  const def = ACTIVES[node.skill];
  p.casts[idx] = def.cd * p.bonus.cdMul;
  const el = def.el;
  const lv = Math.max(1, p.element === el ? p.elementLv : 1);
  const power = stats(p).dmg;
  const ax = Math.cos(p.angle), ay = Math.sin(p.angle);
  const elOpt = { el, elv: lv };
  floatText(state, p.x, p.y - 34, def.name, ELEMENTS[el].color, 0.8);

  switch (node.skill) {
    case 'fireball':
      state.bullets.push(makeBullet(state, p, p.angle, 520, { ...elOpt, kind: 'fireball', r: 9, dmg: 2 + power, life: 1.4, blast: 64, blastWall: true }));
      break;
    case 'meteor': {
      const t = aimPoint(p, inp, 340);
      state.grenades.push({ id: state.nextId++, kind: 'meteor', sx: t.x - 120, sy: t.y - 260, tx: t.x, ty: t.y, t: 0, dur: 1.0, src: p.id, dmg: 8 + power * 2, r: 115, ...elOpt });
      break;
    }
    case 'wave':
      coneHit(state, p, 150, 1.8, 2 + power, 60, elOpt, '#42a5f5');
      break;
    case 'whirlpool': {
      const t = aimPoint(p, inp, 300);
      state.zones.push({ id: state.nextId++, kind: 'whirl', x: t.x, y: t.y, r: 120, t: 3, tick: 0, every: 0.5, src: p.id, dmg: 1, pull: 70, ...elOpt });
      break;
    }
    case 'bolt': {
      const t = aimPoint(p, inp, 380);
      const target = nearest(state.enemies.filter((e) => e.hp > 0), t.x, t.y, 110);
      const x = target ? target.x : t.x, y = target ? target.y : t.y;
      addFx(state, { k: 'l', x, y: y - 220, x2: x, y2: y, c: '#fff176', t: 0.3, life: 0.3 });
      addFx(state, { k: 'r', x, y, r: 40, c: '#fff176', t: 0.25, life: 0.25 });
      if (target) { damageEnemy(state, target, 4 + power, p.id); if (target.hp > 0) applyElement(state, target, { ...elOpt, shooter: p.id, vx: 0, vy: 1 }); }
      break;
    }
    case 'storm':
      state.zones.push({ id: state.nextId++, kind: 'storm', follow: p.id, x: p.x, y: p.y, r: 230, t: 3, tick: 0, every: 0.3, src: p.id, dmg: 3 + power, ...elOpt });
      break;
    case 'icespike':
      state.bullets.push(makeBullet(state, p, p.angle, 700, { ...elOpt, kind: 'icespike', r: 6, dmg: 3 + power, life: 1, pierce: 2 }));
      break;
    case 'blizzard':
      for (let i = 0; i < 5; i++) {
        const a = p.angle + (i / 4 - 0.5) * 0.55;
        state.bullets.push(makeBullet(state, p, a, 720, { ...elOpt, kind: 'icelance', r: 8, dmg: 4 + power, life: 1.1, pierce: 99, freeze: 1.4 }));
      }
      break;
    case 'gust':
      coneHit(state, p, 170, 2.1, 1 + power, 110, elOpt, '#dcedc8');
      break;
    case 'tornado':
      state.zones.push({ id: state.nextId++, kind: 'tornado', x: p.x + ax * 30, y: p.y + ay * 30, vx: ax * 160, vy: ay * 160, r: 72, t: 3, tick: 0, every: 0.3, src: p.id, dmg: 1 + Math.ceil(power / 2), pull: 140, ...elOpt });
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
        damageEnemy(state, e, Math.ceil(st.dmg * 2), p.id);
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
  for (let i = 0; i < p.casts.length; i++) p.casts[i] = Math.max(0, p.casts[i] - dt);
  // 모든 무기 칸의 스킬 쿨타임은 들고 있지 않아도 충전, 시간형 궁극기도 계속 충전
  for (const s of p.weapons) {
    const maxC = WEAPONS[s.key].charges || 1;
    if (s.charges < maxC) {
      s.cd -= dt;
      if (s.cd <= 0) {
        s.charges++;
        s.cd = s.charges < maxC ? skillCdOf(s.key) : 0;
      }
    }
    const ult = SKILLS[weaponFam(s.key)].ult;
    if (!lobby && ult.type === 'time' && !(p.ultT > 0 && s === held(p))) {
      s.ult = Math.min(ult.need, s.ult + dt * (s.el && s.el === p.element ? RESONANCE_ULT : 1) * p.bonus.ultMul);
    }
  }
  if (!p.alive) { p.moving = false; return; }
  const st = stats(p);

  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let my = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) { mx /= len; my /= len; }
  p.moving = len > 0 || p.dashT > 0 || !!p.sdash;

  if (inp.dash && p.dashCd <= 0 && len > 0 && !p.sdash) {
    p.dashT = DASH_TIME;
    p.dashCd = st.dashCd;
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
    moveCircle(state, p, mx * st.speed * dt, my * st.speed * dt, false);
  }

  p.angle = inp.aim;

  // 총 패시브: 연발 가속
  if (st.fam === 'gun') {
    if (inp.fire) { p.spin = Math.min(0.4, p.spin + dt * 0.25); p.spinIdle = 0; }
    else { p.spinIdle += dt; if (p.spinIdle > 1) p.spin = 0; }
  }

  if (st.W.charge) {
    // 강화 활: 누르고 있으면 차지, 떼면 발사
    if (inp.fire && p.fireCd <= 0) p.chargeT = Math.min(st.W.charge, p.chargeT + dt);
    else if (!inp.fire && p.chargeT > 0) {
      shoot(state, p, st, p.chargeT / st.W.charge);
      p.chargeT = 0;
      p.fireCd = st.cd;
    }
  } else if (inp.fire && p.fireCd <= 0 && p.dashT <= 0 && !p.sdash) {
    p.fireCd = st.cd;
    if (st.W.kind === 'ranged') shoot(state, p, st);
    else melee(state, p, st);
  }

  if (lobby) return;
  updateUlt(state, p, st, dt);

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
  if (camp && state.enemies.length === 0 && Math.hypot(p.x - camp.x, p.y - camp.y) <= camp.r && p.hp < maxHpOf(p)) {
    p.healT += dt;
    if (p.healT >= CAMP_HEAL_EVERY) { p.healT = 0; heal(p, 1); }
  } else {
    p.healT = 0;
  }
}

// ---------- 속성 & 원소 반응 ----------
function damageEnemy(state, e, dmg, src) {
  if (e.hp <= 0) return;
  const real = Math.min(e.hp, dmg);
  e.hp -= dmg;
  e.hitT = 0.08;
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
        chainLightning(state, e, lv, 1, src);
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

function enemyBullet(state, e, a, speed, extra = {}) {
  state.bullets.push({
    id: state.nextId++, owner: 'e', shooter: e.id, x: e.x, y: e.y,
    vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
    r: 5, dmg: 1, life: 2.5, pierce: 0, bounce: 0, hits: [], ...extra,
  });
}

// ---------- 보스 ----------
function spawnBoss(state, room) {
  const world = Math.min(BOSSES.length - 1, Math.floor(state.stageIdx / STAGES_PER_WORLD));
  const def = BOSSES[world];
  const n = Object.keys(state.players).length;
  const hp = Math.round(def.hp * (1 + 0.6 * (n - 1)));
  const cx = (room.x0 + room.w / 2) * TILE, cy = (room.y0 + 3.5) * TILE;
  const boss = { ...makeEnemy(state, 'boss', cx, cy, 0), hp, maxHp: hp, world, name: def.name, color: def.color, pattern: 0, patT: 2, act: null, actT: 0, spin: 0 };
  state.enemies.push(boss);
  floatText(state, cx, cy - 60, def.name, '#ff8a80', 2);
}

function updateBoss(state, e, alivePlayers, dt) {
  const target = nearest(alivePlayers, e.x, e.y);
  if (!target) return;
  const half = e.hp < e.maxHp / 2;
  const angle = Math.atan2(target.y - e.y, target.x - e.x);
  const T = ENEMY_TYPES.boss;

  // 진행 중인 행동
  if (e.act === 'charge') {
    e.actT -= dt;
    moveCircle(state, e, Math.cos(e.chargeA) * 430 * dt, Math.sin(e.chargeA) * 430 * dt, true);
    if (e.actT <= 0) e.act = null;
  } else if (e.act === 'spiral') {
    e.actT -= dt;
    e.spin += dt;
    e.tick = (e.tick || 0) - dt;
    if (e.tick <= 0) {
      e.tick = half ? 0.07 : 0.1;
      for (let k = 0; k < (half ? 3 : 2); k++) enemyBullet(state, e, e.spin * 4 + (k * Math.PI * 2) / (half ? 3 : 2), 200);
    }
    if (e.actT <= 0) e.act = null;
  } else {
    // 천천히 다가옴
    const d = Math.hypot(target.x - e.x, target.y - e.y);
    if (d > 120) moveCircle(state, e, Math.cos(angle) * T.speed * dt * (e.st.chill > 0 ? 0.6 : 1), Math.sin(angle) * T.speed * dt, true);
    e.patT -= dt * (half ? 1.5 : 1);
    if (e.patT <= 0) {
      const pats = ['burst', 'volley', 'charge', 'summon', 'spiral'].slice(0, e.world >= 1 ? 5 : 4);
      const pat = pats[e.pattern % pats.length];
      e.pattern++;
      e.patT = 2.2;
      if (pat === 'burst') {
        const n = half ? 22 : 16;
        for (let i = 0; i < n; i++) enemyBullet(state, e, (i / n) * Math.PI * 2 + e.pattern * 0.2, 210, { r: 6 });
      } else if (pat === 'volley') {
        for (let v = 0; v < 3; v++) for (let i = -1; i <= 1; i++) enemyBullet(state, e, angle + i * 0.18, 280 - v * 40);
      } else if (pat === 'charge') {
        e.act = 'charge';
        e.actT = 0.75;
        e.chargeA = angle;
        floatText(state, e.x, e.y - e.r - 10, '!', '#ff5252', 0.6);
      } else if (pat === 'summon') {
        const minions = state.enemies.filter((o) => o.kind !== 'boss').length;
        for (let i = 0; i < Math.max(0, 3 - minions); i++) {
          const a = Math.random() * Math.PI * 2;
          const spot = freeSpotNear(state, e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70);
          state.enemies.push(makeEnemy(state, e.world >= 2 ? 'brute' : e.world >= 1 ? 'archer' : 'slime', spot.x, spot.y, e.world));
          addFx(state, { k: 'r', x: spot.x, y: spot.y, r: 18, c: '#ef5350', t: 0.3, life: 0.3 });
        }
      } else if (pat === 'spiral') {
        e.act = 'spiral';
        e.actT = 2;
      }
    }
  }
  // 몸으로 부딪히면 피해
  for (const p of alivePlayers) {
    if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r && e.cd <= 0) { damagePlayer(state, p, T.touch); e.cd = 0.8; }
  }
}

function updateEnemy(state, e, alivePlayers, dt) {
  const T = ENEMY_TYPES[e.kind];
  e.hitT = Math.max(0, e.hitT - dt);
  if (!updateStatus(state, e, dt) || e.hp <= 0) return; // 빙결/기절 중엔 아무것도 못 함
  e.cd -= dt;
  if (e.kind === 'boss') { updateBoss(state, e, alivePlayers, dt); return; }
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
      enemyBullet(state, e, Math.atan2(dy, dx), T.bulletSpeed);
    }
  } else if (d < e.r + PLAYER_RADIUS + 2 && e.cd <= 0) {
    damagePlayer(state, target, T.touch);
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
      r: 4, dmg: 1, life: 0.8, pierce: 0, bounce: 0, hits: [], el: null, elv: 0, kind: 'turret',
    });
  }
}

function killEnemy(state, e) {
  const T = ENEMY_TYPES[e.kind];
  if (state.mode === 'camp') state.gold += T.gold;
  giveEssence(state, ESSENCE[e.kind] || 1);
  for (let i = 0; i < T.xp && state.orbs.length < MAX_ORBS; i++) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * (e.kind === 'boss' ? 40 : 14);
    state.orbs.push({ id: state.nextId++, x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r, v: 1, taken: [], t: ORB_LIFE });
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
    damageEnemy(state, o, Math.ceil(b.dmg / 2), b.shooter);
    if (b.kind === 'fireball' && o.hp > 0) applyElement(state, o, b);
  }
}

// 플레이어 총알이 적에게 맞았을 때 (패시브·전직 특성)
function bulletHitEnemy(state, b, e) {
  let dmg = b.dmg;
  const p = state.players[b.shooter];
  if (p && b.fam === 'bow' && b.kind !== 'wave') {
    // 활 패시브: 약점 포착
    if (p.markId === e.id) p.markN = Math.min(3, p.markN + 1);
    else { p.markId = e.id; p.markN = 0; }
    dmg += p.markN;
  }
  if (b.crit) floatText(state, e.x, e.y - e.r - 6, '치명!', '#ff8a80', 0.6);
  damageEnemy(state, e, dmg, b.shooter);
  if (p && !['icespike', 'icelance', 'fireball'].includes(b.kind)) staticChain(state, p, e);
  if (b.el && e.hp > 0) applyElement(state, e, b);
  if (b.freeze && e.hp > 0) e.st.frozen = Math.max(e.st.frozen, b.freeze);
  if (b.blast) blastAt(state, b, e.x, e.y, e);
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
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || bulletHitsWall(state, b, dt)) {
      b.dead = true;
      if (b.blastWall) blastAt(state, b, b.x - b.vx * dt, b.y - b.vy * dt, null);
      continue;
    }

    if (b.owner === 'p') {
      for (const e of state.enemies) {
        if (e.hp <= 0 || b.hits.includes(e.id)) continue;
        if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < (e.r + b.r) ** 2) {
          bulletHitEnemy(state, b, e);
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
          damagePlayer(state, p, b.dmg);
          b.dead = true;
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
    giveEssence(state, ESSENCE.wave + state.wave);
    for (const p of players) if (p.alive && hasPerk(p, 'tide')) heal(p, 1);
    // 3웨이브마다 캠프 옆에 보물상자
    if (state.wave % 3 === 0) spawnChest(state, state.map.camp.x + 64, state.map.camp.y);
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
  floatText(state, alive[0]?.x ?? 0, (alive[0]?.y ?? 0) - 30, boss ? '보스 처치!' : '방 클리어!', boss ? '#ffd54f' : '#a5d6a7', 1.6);
  for (const p of Object.values(state.players)) if (!p.alive && alive[0]) revive(state, p, 0.5, alive[0]);
  for (const p of alive) if (hasPerk(p, 'tide')) heal(p, 1);
  giveEssence(state, ESSENCE.room);
  // 보물상자: 보스방은 반드시, 일반 방은 확률로 (스테이지의 마지막 전투 방에서 아직 없었다면 반드시)
  const left = state.map.rooms.filter((r) => (r.type === 'battle' || r.type === 'boss') && r.state !== 'cleared').length;
  if (boss || Math.random() < CHEST_CHANCE || (left === 0 && state.chestsThisStage === 0)) {
    const cx = (room.x0 + room.w / 2) * TILE, cy = (room.y0 + room.h / 2) * TILE;
    spawnChest(state, cx + (boss ? 80 : 0), cy);
  }
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
  Object.assign(state, { enemies: [], bullets: [], orbs: [], fx: [], grenades: [], zones: [], chests: [], pickups: [] });
  for (const p of Object.values(state.players)) {
    p.reward = makeReward(p);
    p.rewardDone = false;
    // 들고 있는 무기가 1단계면 전직 선택지 2개 (안 해도 됨)
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
  updateBullets(state, dt);
  updateGrenadesAndZones(state, dt);
  // 총알·스킬·지속 피해·반응 어떤 이유로든 쓰러진 적은 마지막으로 때린 사람에게 점수를 줍니다.
  for (const e of state.enemies) if (e.hp <= 0) killEnemy(state, e);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  updateEffects(state, players, dt);

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
const r2 = (n) => Math.round(n * 100) / 100;

function statusCode(s) {
  return (s.burn > 0 ? 'b' : '') + (s.wet > 0 ? 'w' : '') + (s.chill > 0 ? 'c' : '')
    + (s.frozen > 0 ? 'f' : '') + (s.poison > 0 ? 'p' : '') + (s.stun > 0 ? 'z' : '');
}

function roomCode(r) {
  if (r.state === 'active') return 'a';
  if (r.state === 'cleared' || (r.seen && r.type !== 'battle' && r.type !== 'boss')) return 'c';
  return r.seen ? 's' : '-';
}

function bulletSnap(b) {
  return {
    x: r1(b.x), y: r1(b.y), r: b.r, o: b.owner === 'p' ? 0 : 1, el: b.el || 0, k: b.kind || 0,
    a: b.kind === 'turret' ? 0 : r2(Math.atan2(b.vy, b.vx)), st: b.stuck ? 1 : 0,
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
    rs: state.map.rooms.map(roomCode).join(''),
    ar: state.activeRoom ? state.activeRoom.id : -1,
    pt: r1(state.portalT),
    po: !state.map.boss || bossRoom?.state === 'cleared' ? 1 : 0,
    bs: boss ? { n: boss.name, hp: boss.hp, mh: boss.maxHp } : null,
    tt: Math.ceil(state.transT),
    ot: state.overText,
    w: state.wave,
    wt: r1(Math.max(0, state.waveTimer)),
    g: state.gold,
    p: Object.values(state.players).map((p) => ({
      id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y),
      a: r2(p.angle), hp: p.hp, mh: maxHpOf(p),
      al: p.alive ? 1 : 0, s: p.score, iv: p.invuln > 0 ? 1 : 0, mv: p.moving ? 1 : 0, ds: p.dashT > 0 || p.sdash ? 1 : 0,
      bf: p.buffs, at: p.augTypes.length, of: p.offer, oq: p.offerQueue, rd: p.ready ? 1 : 0,
      el: p.element, elv: p.elementLv, pz: p.paused ? 1 : 0, wp: p.weapon,
      lv: p.level, xp: Math.floor(p.xp), xn: xpToNext(p.level), es: Math.floor(p.es),
      rw: p.reward, rwd: p.rewardDone ? 1 : 0, ev: p.evo, evd: p.evoDone ? 1 : 0,
      ws: p.weapons.map((s) => ({
        k: s.key, el: s.el, u: Math.floor((s.ult / SKILLS[weaponFam(s.key)].ult.need) * 100),
        cd: r1(Math.max(0, s.cd)), c: s.charges, cm: WEAPONS[s.key].charges || 1,
      })),
      sl: p.slot, sw: r1(p.swapCd), ut: r1(p.ultT), ch: WEAPONS[held(p).key].charge ? r2(p.chargeT / WEAPONS[held(p).key].charge) : 0,
      jv: p.javelin ? 1 : 0, ld: p.loadout, cs: p.casts.map(r1), sgt: r2(p.swingT / SWING_TIME), sgd: p.swingDir,
    })),
    e: state.enemies.map((e) => ({
      id: e.id, k: e.kind, x: r1(e.x), y: r1(e.y), r: e.r,
      hp: e.hp, mh: e.maxHp, h: e.hitT > 0 ? 1 : 0, s: statusCode(e.st), c: e.color || 0, ch: e.act === 'charge' ? 1 : 0,
    })),
    st: state.structs.map((s) => ({
      id: s.id, k: s.kind, tx: s.tx, ty: s.ty, hp: s.hp, mh: s.maxHp,
      a: s.angle !== undefined ? r2(s.angle) : 0,
    })),
    b: [
      ...state.bullets.map(bulletSnap),
      ...state.grenades.map((g) => {
        const t = g.t / g.dur;
        if (g.kind === 'meteor') return { x: r1(g.sx + (g.tx - g.sx) * t), y: r1(g.sy + (g.ty - g.sy) * t), r: 14, o: 0, el: g.el, k: 'meteor', a: 0, tx: r1(g.tx), ty: r1(g.ty), rr: g.r };
        return { x: r1(g.sx + (g.tx - g.sx) * t), y: r1(g.sy + (g.ty - g.sy) * t - Math.sin(Math.PI * t) * 40), r: 5, o: 0, el: g.el || 0, k: 'grenade', a: 0 };
      }),
    ],
    zn: state.zones.map((z) => ({ k: z.kind, x: r1(z.x), y: r1(z.y), r: z.r, t: r1(z.t), el: z.el || 0 })),
    cs: state.chests.map((c) => ({ id: c.id, x: c.x, y: c.y, o: c.open ? 1 : 0 })),
    pk: state.pickups.map((o) => ({ id: o.id, x: r1(o.x), y: r1(o.y), k: o.key, el: o.el || 0 })),
    xo: state.orbs.map((o) => ({ id: o.id, x: r1(o.x), y: r1(o.y), tk: o.taken })),
    fx: state.fx.map((f) => ({ ...f, x: r1(f.x), y: r1(f.y), t: r1(f.t) })),
  };
}

export { LOADOUT_SIZE };
