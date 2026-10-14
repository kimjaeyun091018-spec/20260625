// 로비 스킬 트리 (성키우기처럼 가운데에서 뻗어 나가는 나무)
// - 노드는 정수(게임 중 얻는 재화)로 해금하고, 한 번 해금하면 계정에 영구 저장됩니다.
// - 빌드 칸(최대 4개): 캐릭터 속성 1개 + 해금한 스킬 중 4개 장착 (데드 바이 데이라이트의 퍽 4칸처럼)
//   처음 저장은 무료, 저장된 칸을 다시 고치려면 초기화 비용, 칸을 늘리려면 구매 비용.
// - 일반 노드(스탯)는 해금하면 항상 적용, 숙련 노드는 캐릭터 속성이 같을 때만 적용.

import { ELEMENTS, SKINS } from './data.js';

export const LOADOUT_SIZE = 4;
export const MAX_BUILD_SLOTS = 4;
export const SLOT_PRICES = [0, 120, 240, 400]; // 1칸은 무료로 시작
export const RESET_COST = 25;
export const START_ESSENCE = 40;

const EL_ORDER = ['fire', 'water', 'electric', 'ice', 'wind', 'poison'];

// 액티브 스킬 (장착하면 1~4 키로 사용)
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
  tide: { el: 'water', name: '치유의 물', desc: '방·웨이브를 클리어하면 체력 +1' },
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

// 노드 목록 만들기 (위치는 화면 좌표, 가운데가 0,0)
function buildNodes() {
  const nodes = [{ id: 'start', kind: 'start', name: '시작', desc: '모든 길은 여기서 시작됩니다', cost: 0, x: 0, y: 0, links: [] }];
  GENERAL.forEach((g, i) => {
    const a = ((i * 60 + 30) * Math.PI) / 180 - Math.PI / 2;
    nodes.push({ ...g, kind: 'general', cost: COST.general, x: Math.cos(a) * 82, y: Math.sin(a) * 82, links: ['start'] });
  });
  EL_ORDER.forEach((el, i) => {
    const a = ((i * 60) * Math.PI) / 180 - Math.PI / 2;
    const at = (r, side = 0) => ({ x: Math.cos(a) * r - Math.sin(a) * side, y: Math.sin(a) * r + Math.cos(a) * side });
    const actives = Object.entries(ACTIVES).filter(([, v]) => v.el === el).map(([k]) => k);
    const perk = Object.entries(PERKS).find(([, v]) => v.el === el)[0];
    const E = ELEMENTS[el];
    const chain = [
      { id: `${el}_root`, kind: 'root', el, name: `${E.name} 각인`, desc: `캐릭터 속성으로 ${E.name}을(를) 고를 수 있음`, cost: COST.root, ...at(118) },
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
  });
  return nodes;
}

export const TREE = buildNodes();
export const NODE = Object.fromEntries(TREE.map((n) => [n.id, n]));
export const equipable = (id) => ['active', 'perk'].includes(NODE[id]?.kind);

// 노드를 해금할 수 있는지 (이웃 노드 중 하나가 해금돼 있어야 함)
export function canUnlock(unlocked, id) {
  const n = NODE[id];
  if (!n || unlocked.includes(id)) return false;
  return n.links.every((l) => l === 'start' || unlocked.includes(l));
}

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
  const base = { essence: START_ESSENCE, unlocked: [], owned: 1, active: 0, slots: [emptySlot()], skins: ['shadow'], skin: 'shadow' };
  if (!s || typeof s !== 'object') return base;
  const save = { ...base, ...s };
  save.unlocked = (Array.isArray(save.unlocked) ? save.unlocked : []).filter((id) => NODE[id]);
  save.owned = Math.max(1, Math.min(MAX_BUILD_SLOTS, Number(save.owned) || 1));
  save.slots = Array.from({ length: MAX_BUILD_SLOTS }, (_, i) => ({ ...emptySlot(), ...(save.slots?.[i] || {}) }));
  save.active = Math.min(save.owned - 1, Math.max(0, Number(save.active) || 0));
  save.essence = Math.max(0, Math.floor(Number(save.essence) || 0));
  save.skins = [...new Set(['shadow', ...(Array.isArray(save.skins) ? save.skins : [])])].filter((k) => SKINS[k]);
  if (!save.skins.includes(save.skin)) save.skin = 'shadow';
  return save;
}

export function writeSave(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* 무시 */ }
}

// 게임에 가져갈 빌드: 지금 고른 칸을 그대로 적용 (저장은 '잠금'일 뿐, 저장 안 해도 적용됨)
// 칸에 속성을 안 골랐으면 해금한 첫 속성 각인을 캐릭터 속성으로 씁니다.
export function currentBuild(save) {
  const slot = save.slots[save.active] || emptySlot();
  const firstRoot = save.unlocked.map((id) => NODE[id]).find((n) => n?.kind === 'root');
  const el = slot.el || firstRoot?.el || null;
  // 장착 칸이 비어 있고 저장(잠금) 전이면, 해금한 스킬을 차례로 자동 장착
  const eq = slot.eq.length || slot.saved ? [...slot.eq] : save.unlocked.filter(equipable).slice(0, LOADOUT_SIZE);
  return { el, eq, nodes: save.unlocked, skin: save.skin };
}

// 방장이 받은 빌드를 검사 (없는 노드, 해금 안 된 장착 등은 버림)
export function sanitizeBuild(b) {
  const nodes = (Array.isArray(b?.nodes) ? b.nodes : []).filter((id) => typeof id === 'string' && NODE[id]).slice(0, TREE.length);
  const el = ELEMENTS[b?.el] && nodes.includes(`${b.el}_root`) ? b.el : null;
  const eq = [...new Set((Array.isArray(b?.eq) ? b.eq : []).filter((id) => nodes.includes(id) && equipable(id)))].slice(0, LOADOUT_SIZE);
  const skin = SKINS[b?.skin] ? b.skin : 'shadow';
  return { el, eq, nodes, skin };
}

// ---------- 저장 코드 (다른 기기로 옮기기) ----------
function checksum(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 1000003;
  return h.toString(36);
}

export function exportSaveCode(save) {
  const json = JSON.stringify({ essence: save.essence, unlocked: save.unlocked, owned: save.owned, active: save.active, slots: save.slots, skins: save.skins, skin: save.skin });
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
  const out = { hp: 0, dmgPct: 0, speed: 0, xp: 0, ess: 0, cd: 0, elLv: 0 };
  for (const id of build.nodes) {
    const n = NODE[id];
    if (n.kind === 'general') for (const [k, v] of Object.entries(n.bonus)) out[k] += v;
    if (n.kind === 'mastery' && n.el === build.el) out.elLv += 1;
  }
  return out;
}
