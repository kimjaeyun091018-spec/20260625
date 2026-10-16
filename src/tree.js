// 로비 스킬 트리 (성키우기처럼 가운데에서 뻗어 나가는 나무)
// - 노드는 정수(게임 중 얻는 재화)로 해금하고, 한 번 해금하면 계정에 영구 저장됩니다.
// - 빌드 칸(최대 4개): 캐릭터 속성 1개 + 액티브 3칸 + 패시브 2칸 장착
//   처음 저장은 무료, 저장된 칸을 다시 고치려면 초기화 비용, 칸을 늘리려면 구매 비용.
// - 일반 노드(스탯)는 해금하면 항상 적용, 숙련 노드는 캐릭터 속성이 같을 때만 적용.

import { ELEMENTS, SKINS, UNITS, UNIT_MAX_LV, ARMY_SLOTS, SUPPLIES, CHARACTERS, CHARACTER_KEYS, baseSkin, OLD_SKIN_PRICE } from './data.js';

export const ACTIVE_SLOTS = 3;   // 액티브 칸 (1·2·3 키)
export const PASSIVE_SLOTS = 2;  // 패시브 칸 (항상 켜짐)
export const LOADOUT_SIZE = ACTIVE_SLOTS + PASSIVE_SLOTS;
export const MAX_BUILD_SLOTS = 4;
export const SLOT_PRICES = [0, 120, 240, 400]; // 1칸은 무료로 시작
export const RESET_COST = 25;
export const START_ESSENCE = 40;

const EL_ORDER = ['fire', 'water', 'electric', 'ice', 'wind', 'poison'];

// 액티브 스킬 (액티브 칸에 장착하면 1~3 키로 사용)
export const ACTIVES = {
  fireball: { el: 'fire', name: '화염구', cd: 6, desc: '부딪히면 폭발하는 화염구' },
  meteor: { el: 'fire', name: '메테오', cd: 16, desc: '마우스 위치에 1초 뒤 거대한 운석 낙하' },
  wave: { el: 'water', name: '물결', cd: 7, desc: '앞쪽으로 물결을 밀어 적을 밀치고 적심' },
  whirlpool: { el: 'water', name: '소용돌이', cd: 15, desc: '3초간 적을 빨아들이는 소용돌이' },
  bolt: { el: 'electric', name: '낙뢰', cd: 6, desc: '마우스 근처 적에게 번개' },
  storm: { el: 'electric', name: '뇌우', cd: 18, desc: '3초간 주변 적에게 번개가 연달아 떨어짐' },
  icespike: { el: 'ice', name: '얼음 가시', cd: 5, desc: '관통하는 얼음 가시' },
  blizzard: { el: 'ice', name: '블리자드 랜스', cd: 16, desc: '얼음 창 5개를 부채꼴로 발사, 맞으면 빙결' },
  gust: { el: 'wind', name: '돌풍', cd: 6, desc: '앞쪽 적을 멀리 날려 보냄' },
  tornado: { el: 'wind', name: '토네이도', cd: 16, desc: '적을 휘말며 앞으로 나아가는 회오리' },
  cloud: { el: 'poison', name: '독구름', cd: 8, desc: '4초간 독을 퍼뜨리는 구름' },
  plague: { el: 'poison', name: '역병', cd: 18, desc: '주변 모든 적에게 독 3중첩' },
};

// 패시브 특성 (장착 칸을 차지하지만 항상 켜져 있음)
export const PERKS = {
  ember: { el: 'fire', name: '불씨', desc: '화상 걸린 적이 쓰러지면 작게 폭발' },
  tide: { el: 'water', name: '치유의 물', desc: '방을 클리어하면 체력 +1 (생존 모드: 1분마다)' },
  static: { el: 'electric', name: '정전기', desc: '대시 후 1.5초 동안 공격이 연쇄 번개를 일으킴' },
  frostarmor: { el: 'ice', name: '서리 갑옷', desc: '피격 시 주변 적 둔화' },
  tailwind: { el: 'wind', name: '순풍', desc: '대시 쿨타임 -30%, 이동 속도 +8%' },
  venom: { el: 'poison', name: '맹독', desc: '독 최대 중첩 +2' },
};

// 일반 노드 (해금하면 항상 적용)
const GENERAL = [
  { id: 'g_hp', name: '활력', desc: '최대 체력 +2', bonus: { hp: 2 } },
  { id: 'g_dmg', name: '힘', desc: '피해 +10%', bonus: { dmgPct: 0.1 } },
  { id: 'g_speed', name: '민첩', desc: '이동 속도 +8%', bonus: { speed: 0.08 } },
  { id: 'g_xp', name: '지혜', desc: '경험치 +20%', bonus: { xp: 0.2 } },
  { id: 'g_ess', name: '탐욕', desc: '정수 획득 +25%', bonus: { ess: 0.25 } },
  { id: 'g_cd', name: '집중', desc: '장착 스킬 쿨타임 -15%', bonus: { cd: 0.15 } },
];

const COST = { general: 20, root: 25, active1: 40, perk: 60, mastery: 80, active2: 120 };

// 거미줄 바깥 가지: 일반 노드에서 뻗어 나가는 스탯 3개 + 끝의 왕관 노드 (왕관 = 보스를 잡아서 얻는 재화)
const BRANCHES = [
  { key: 'castle', from: 'g_hp', color: '#bcaaa4', nodes: [
    { name: '성벽 보강', desc: '성 최대 체력 +10', bonus: { castleHp: 10 } },
    { name: '궁수탑', desc: '성 화살 피해 +50%', bonus: { castleArrow: 0.5 } },
    { name: '군자금', desc: '성 지키기 시작 골드 +20', bonus: { startGold: 20 } },
  ], crown: { name: '난공불락', desc: '성 최대 체력 +50%', bonus: { castlePct: 0.5 }, cost: 2 } },
  { key: 'combat', from: 'g_dmg', color: '#ef9a9a', nodes: [
    { name: '급소', desc: '치명타율 +5%', bonus: { crit: 0.05 } },
    { name: '연마', desc: '피해 +8%', bonus: { dmgPct: 0.08 } },
    { name: '전투 본능', desc: '치명타율 +5%', bonus: { crit: 0.05 } },
  ], crown: { name: '왕의 검', desc: '피해 +15%', bonus: { dmgPct: 0.15 }, cost: 2 } },
  { key: 'army', from: 'g_speed', color: '#90caf9', nodes: [
    { name: '훈련 교관', desc: '군단 유닛 체력 +15%', bonus: { unitHp: 0.15 } },
    { name: '모병관', desc: '군단 소환 비용 -10%', bonus: { summon: 0.1 } },
    { name: '전술 교본', desc: '군단 유닛 피해 +15%, 최대 유닛 +3', bonus: { unitDmg: 0.15, armyCap: 3 } },
  ], crown: { name: '거인의 맹약', desc: '군단 유닛 거인 해금', bonus: { giant: 1 }, cost: 3 } },
  { key: 'mana', from: 'g_xp', color: '#9fa8da', nodes: [
    { name: '마나 그릇', desc: '최대 마나 +20', bonus: { mana: 20 } },
    { name: '마나 흡수', desc: '마나 구슬 +20%', bonus: { manaGain: 0.2 } },
    { name: '명상', desc: '최대 마나 +30', bonus: { mana: 30 } },
  ], crown: { name: '마력 샘', desc: '최대 마나 +50, 마나 구슬 +25%', bonus: { mana: 50, manaGain: 0.25 }, cost: 2 } },
  { key: 'loot', from: 'g_ess', color: '#ffe082', nodes: [
    { name: '주머니', desc: '동전·골드 +15%', bonus: { coin: 0.15 } },
    { name: '흥정', desc: '상점 가격 -10%', bonus: { shop: 0.1 } },
    { name: '보물 사냥꾼', desc: '동전·골드 +15%', bonus: { coin: 0.15 } },
  ], crown: { name: '황금 손', desc: '동전·골드 +30%, 정수 +20%', bonus: { coin: 0.3, ess: 0.2 }, cost: 2 } },
  { key: 'survive', from: 'g_cd', color: '#a5d6a7', nodes: [
    { name: '단련', desc: '최대 체력 +1', bonus: { hp: 1 } },
    { name: '구르기', desc: '대시 쿨타임 -15%', bonus: { dash: 0.15 } },
    { name: '강철 심장', desc: '최대 체력 +2', bonus: { hp: 2 } },
  ], crown: { name: '두 번째 심장', desc: '판마다 한 번, 쓰러지면 바로 부활 (불사조의 깃털)', bonus: { phoenix: 1 }, cost: 3 } },
];

// 노드 목록 만들기 (위치는 화면 좌표, 가운데가 0,0). links = 연결된 이웃 (거미줄)
function buildNodes() {
  const nodes = [{ id: 'start', kind: 'start', name: '시작', desc: '모든 길은 여기서 시작됩니다', cost: 0, x: 0, y: 0, links: [] }];
  GENERAL.forEach((g, i) => {
    const a = ((i * 60 + 30) * Math.PI) / 180 - Math.PI / 2;
    // 일반 노드는 시작점과, 옆의 일반 노드와도 이어짐 (안쪽 고리)
    const prev = GENERAL[(i + GENERAL.length - 1) % GENERAL.length].id;
    nodes.push({ ...g, kind: 'general', cost: COST.general, x: Math.cos(a) * 82, y: Math.sin(a) * 82, links: ['start', ...(i > 0 ? [prev] : [])] });
  });
  nodes.find((n) => n.id === GENERAL[0].id).links.push(GENERAL[GENERAL.length - 1].id);
  EL_ORDER.forEach((el, i) => {
    const a = ((i * 60) * Math.PI) / 180 - Math.PI / 2;
    const at = (r, side = 0) => ({ x: Math.cos(a) * r - Math.sin(a) * side, y: Math.sin(a) * r + Math.cos(a) * side });
    const actives = Object.entries(ACTIVES).filter(([, v]) => v.el === el).map(([k]) => k);
    const perk = Object.entries(PERKS).find(([, v]) => v.el === el)[0];
    const E = ELEMENTS[el];
    const chain = [
      { id: `${el}_root`, kind: 'root', el, name: `${E.name} 각인`, desc: `캐릭터 속성이 ${E.name}이(가) 됨`, cost: COST.root, ...at(118) },
      { id: `a_${actives[0]}`, kind: 'active', el, skill: actives[0], cost: COST.active1, ...at(170, -18) },
      { id: `p_${perk}`, kind: 'perk', el, perk, cost: COST.perk, ...at(222, 18) },
      { id: `${el}_mastery`, kind: 'mastery', el, name: `${E.name} 숙련`, desc: `캐릭터 속성이 ${E.name}이면 속성 레벨 +1`, cost: COST.mastery, ...at(274, -18) },
      { id: `a_${actives[1]}`, kind: 'active', el, skill: actives[1], cost: COST.active2, ...at(330, 0) },
    ];
    chain.forEach((n, j) => {
      if (n.kind === 'active') Object.assign(n, { name: ACTIVES[n.skill].name, desc: `${ACTIVES[n.skill].desc} (쿨타임 ${ACTIVES[n.skill].cd}초)` });
      if (n.kind === 'perk') Object.assign(n, { name: PERKS[n.perk].name, desc: PERKS[n.perk].desc });
      n.links = [j === 0 ? 'start' : chain[j - 1].id];
      nodes.push(n);
    });
    // 속성 각인은 양옆 일반 노드와도 이어짐
    nodes.find((n) => n.id === `${el}_root`).links.push(GENERAL[i].id, GENERAL[(i + 5) % 6].id);
  });
  // 바깥 가지 (일반 노드 방향으로 뻗음) + 옆 속성 가지와 가로로 이어짐
  BRANCHES.forEach((B) => {
    const gi = GENERAL.findIndex((g) => g.id === B.from);
    const a = ((gi * 60 + 30) * Math.PI) / 180 - Math.PI / 2;
    const left = EL_ORDER[gi], right = EL_ORDER[(gi + 1) % 6];
    const ids = B.nodes.map((_, j) => `b_${B.key}${j + 1}`);
    B.nodes.forEach((n, j) => {
      const r = 160 + j * 72;
      const links = [j === 0 ? B.from : ids[j - 1]];
      if (j === 1) links.push(`p_${Object.entries(PERKS).find(([, v]) => v.el === left)[0]}`);
      if (j === 2) links.push(`${right}_mastery`);
      nodes.push({ id: ids[j], kind: 'stat', branch: B.key, color: B.color, ...n, cost: 30 + 20 * j, x: Math.cos(a) * r, y: Math.sin(a) * r, links });
    });
    nodes.push({ id: `c_${B.key}`, kind: 'crown', branch: B.key, color: '#ff7043', ...B.crown, crown: B.crown.cost, cost: 0,
      x: Math.cos(a) * 420, y: Math.sin(a) * 420, links: [ids[2]] });
  });
  return nodes;
}

export const TREE = buildNodes();
export const NODE = Object.fromEntries(TREE.map((n) => [n.id, n]));
// 이웃 목록 (양방향)
const NEIGHBORS = Object.fromEntries(TREE.map((n) => [n.id, new Set()]));
for (const n of TREE) for (const l of n.links) { NEIGHBORS[n.id].add(l); NEIGHBORS[l].add(n.id); }
export const equipable = (id) => ['active', 'perk'].includes(NODE[id]?.kind);
export const isActive = (id) => NODE[id]?.kind === 'active';
export const isPassive = (id) => NODE[id]?.kind === 'perk';

// 장착 목록을 액티브 3칸 + 패시브 2칸 규칙에 맞게 자름 (순서 유지)
export function fitLoadout(eq) {
  const act = eq.filter(isActive).slice(0, ACTIVE_SLOTS);
  const pas = eq.filter(isPassive).slice(0, PASSIVE_SLOTS);
  return [...act, ...pas];
}

// 노드를 해금할 수 있는지: 거미줄처럼 이웃 노드 중 하나라도 해금돼 있으면 됨 (시작점은 항상 해금)
export function canUnlock(unlocked, id) {
  const n = NODE[id];
  if (!n || unlocked.includes(id) || n.kind === 'start') return false;
  return [...NEIGHBORS[id]].some((l) => l === 'start' || unlocked.includes(l));
}
export const nodePrice = (n) => (n.kind === 'crown' ? { crown: n.crown } : { essence: n.cost });

// ---------- 저장 (이 브라우저에만 저장, 로그인하면 계정마다 따로) ----------
const BASE_KEY = 'sk-save-v1';
let SAVE_KEY = BASE_KEY;
export function setSaveAccount(id) {
  SAVE_KEY = id ? `${BASE_KEY}:${id}` : BASE_KEY;
}

export function emptySlot() {
  return { saved: false, el: null, eq: [] };
}

export function loadSave(from) {
  let s = from || null;
  if (!s) try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* 저장소 사용 불가 */ }
  const base = { essence: START_ESSENCE, crowns: 0, spoils: 0, supplies: {}, unlocked: [], owned: 1, active: 0, slots: [emptySlot()], chars: ['knight'], skins: [], skinOf: {}, army: { unlocked: ['knight', 'archer'], lv: {}, sel: ['knight', 'archer'] } };
  if (!s || typeof s !== 'object') return base;
  const save = { ...base, ...s };
  save.unlocked = (Array.isArray(save.unlocked) ? save.unlocked : []).filter((id) => NODE[id]);
  save.owned = Math.max(1, Math.min(MAX_BUILD_SLOTS, Number(save.owned) || 1));
  save.slots = Array.from({ length: MAX_BUILD_SLOTS }, (_, i) => ({ ...emptySlot(), ...(save.slots?.[i] || {}) }));
  save.active = Math.min(save.owned - 1, Math.max(0, Number(save.active) || 0));
  save._t = Math.max(0, Number(save._t) || 0);
  save.essence = Math.max(0, Math.floor(Number(save.essence) || 0));
  save.crowns = Math.max(0, Math.floor(Number(save.crowns) || 0));
  save.spoils = Math.max(0, Math.floor(Number(save.spoils) || 0));
  save.supplies = Object.fromEntries(Object.keys(SUPPLIES).filter((k) => save.supplies?.[k]).map((k) => [k, true]));
  const army = save.army && typeof save.army === 'object' ? save.army : {};
  save.army = {
    unlocked: [...new Set(['knight', 'archer', ...(Array.isArray(army.unlocked) ? army.unlocked : [])])].filter((k) => UNITS[k]),
    lv: Object.fromEntries(Object.entries(army.lv || {}).filter(([k]) => UNITS[k]).map(([k, v]) => [k, Math.max(1, Math.min(UNIT_MAX_LV, Math.floor(v) || 1))])),
    sel: [],
  };
  save.army.sel = [...new Set(Array.isArray(army.sel) ? army.sel : ['knight', 'archer'])].filter((k) => save.army.unlocked.includes(k)).slice(0, ARMY_SLOTS);
  // 캐릭터: 산 캐릭터만 고를 수 있음 (기사는 처음부터)
  save.chars = [...new Set(['knight', ...(Array.isArray(save.chars) ? save.chars : [])])].filter((k) => CHARACTERS[k]);
  delete save.freeChar;
  // 예전 공용 스킨은 정수로 돌려줌 (한 번만: 바꾼 뒤엔 새 스킨 이름만 남음)
  const oldSkins = Array.isArray(save.skins) ? save.skins : [];
  const refund = oldSkins.reduce((n, k) => n + (OLD_SKIN_PRICE[k] || 0), 0);
  if (refund) { save.essence += refund; save.refunded = refund; }
  delete save.skin;
  // 스킨: 캐릭터마다 기본 스킨은 공짜, 캐릭터마다 입은 스킨을 따로 기억
  save.skins = [...new Set([...CHARACTER_KEYS.map(baseSkin), ...oldSkins])].filter((k) => SKINS[k]);
  const so = save.skinOf && typeof save.skinOf === 'object' ? save.skinOf : {};
  save.skinOf = Object.fromEntries(CHARACTER_KEYS.map((c) => [c, SKINS[so[c]]?.char === c && save.skins.includes(so[c]) ? so[c] : baseSkin(c)]));
  return save;
}

// 저장할 때마다 부르는 함수 (구글 계정이면 클라우드에 올리기)
let saveHook = null;
export function onSaveWrite(fn) { saveHook = fn; }
// quiet: 클라우드에서 받아 온 저장을 그대로 적을 때 (시간·업로드 안 건드림)
export function writeSave(save, quiet = false) {
  if (!quiet) save._t = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 무시 */ }
  if (!quiet) saveHook?.(save);
}
// 이 계정의 저장이 이 기기에 있는지
export function hasLocalSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

// 게임에 가져갈 빌드: 지금 고른 칸을 그대로 적용 (저장은 '잠금'일 뿐, 저장 안 해도 적용됨)
// 칸에 속성을 안 골랐으면 해금한 첫 속성 각인을 캐릭터 속성으로 씁니다.
export function currentBuild(save) {
  const slot = save.slots[save.active] || emptySlot();
  const firstRoot = save.unlocked.map((id) => NODE[id]).find((n) => n?.kind === 'root');
  const el = slot.el || firstRoot?.el || null;
  // 장착 칸이 비어 있고 저장(잠금) 전이면, 해금한 스킬을 차례로 자동 장착
  const eq = fitLoadout(slot.eq.length || slot.saved ? slot.eq : save.unlocked.filter(equipable));
  return { el, eq, nodes: save.unlocked, chars: save.chars, skinOf: save.skinOf, army: { sel: save.army.sel, lv: save.army.lv }, guild: save.guild || null, supplies: { ...save.supplies } };
}

// 방장이 받은 빌드를 검사 (없는 노드, 해금 안 된 장착 등은 버림)
export function sanitizeBuild(b) {
  const nodes = (Array.isArray(b?.nodes) ? b.nodes : []).filter((id) => typeof id === 'string' && NODE[id]).slice(0, TREE.length);
  const el = ELEMENTS[b?.el] && nodes.includes(`${b.el}_root`) ? b.el : null;
  const eq = fitLoadout([...new Set((Array.isArray(b?.eq) ? b.eq : []).filter((id) => nodes.includes(id) && equipable(id)))]);
  const chars = [...new Set(['knight', ...(Array.isArray(b?.chars) ? b.chars : [])])].filter((k) => CHARACTERS[k]).slice(0, CHARACTER_KEYS.length);
  const skinOf = Object.fromEntries(CHARACTER_KEYS.map((c) => [c, SKINS[b?.skinOf?.[c]]?.char === c ? b.skinOf[c] : baseSkin(c)]));
  // 군단: 데려갈 유닛 4종과 레벨 (거인은 왕관 노드가 있어야)
  const lvOf = (k) => Math.max(1, Math.min(UNIT_MAX_LV, Math.floor(Number(b?.army?.lv?.[k]) || 1)));
  const sel = [...new Set(Array.isArray(b?.army?.sel) ? b.army.sel : ['knight', 'archer'])].filter((k) => UNITS[k] && (k !== 'giant' || nodes.includes('c_army'))).slice(0, ARMY_SLOTS);
  const army = { sel, lv: Object.fromEntries(sel.map((k) => [k, lvOf(k)])) };
  // 길드: 이름·레벨만 (보너스 계산용)
  const g = b?.guild;
  const guild = g && typeof g.id === 'string' ? { id: g.id.slice(0, 40), name: String(g.name || '').slice(0, 12), lv: Math.max(1, Math.min(20, Math.floor(Number(g.lv) || 1))), color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#ffd54f' } : null;
  const supplies = Object.fromEntries(Object.keys(SUPPLIES).filter((k) => b?.supplies?.[k]).map((k) => [k, true]));
  return { el, eq, nodes, chars, skinOf, army, guild, supplies };
}

// ---------- 저장 코드 (다른 기기로 옮기기) ----------
function checksum(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003;
  return h.toString(36);
}

export function exportSaveCode(save) {
  const json = JSON.stringify({ essence: save.essence, crowns: save.crowns, spoils: save.spoils, supplies: save.supplies, army: save.army, unlocked: save.unlocked, owned: save.owned, active: save.active, slots: save.slots, chars: save.chars, skins: save.skins, skinOf: save.skinOf });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `DS1-${checksum(b64)}-${b64}`;
}

export function importSaveCode(code) {
  const m = /^DS1-([0-9a-z]+)-([A-Za-z0-9+/=]+)$/.exec(String(code).trim().replace(/\s+/g, ''));
  if (!m || checksum(m[2]) !== m[1]) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(m[2]))));
  } catch {
    return null;
  }
}

// 빌드가 주는 보너스 합계
export function buildBonus(build) {
  const out = { hp: 0, dmgPct: 0, speed: 0, xp: 0, ess: 0, cd: 0, elLv: 0, castleHp: 0, castleArrow: 0, castlePct: 0, startGold: 0, crit: 0,
    unitHp: 0, unitDmg: 0, summon: 0, armyCap: 0, giant: 0, mana: 0, manaGain: 0, coin: 0, shop: 0, dash: 0, phoenix: 0 };
  for (const id of build.nodes) {
    const n = NODE[id];
    if (n.bonus && n.kind !== 'mastery') for (const [k, v] of Object.entries(n.bonus)) out[k] = (out[k] || 0) + v;
    if (n.kind === 'mastery' && n.el === build.el) out.elLv += 1;
  }
  return out;
}
