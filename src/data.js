// 게임 데이터(수치) 모음 — 밸런스는 대부분 여기서 조절합니다.

export const TILE = 32;
export const VIEW_W = 960;   // 화면(캔버스) 크기
export const VIEW_H = 640;
export const MAX_PLAYERS = 4;

export const MODES = {
  camp: { name: '베이스캠프', desc: '탕탕특공대처럼 10분 동안 몰려오는 적을 버티기 (자동 스킬·조합 진화)' },
  adv: { name: '모험', desc: '랜덤 던전의 방을 하나씩 정복하고 포털로 다음 스테이지로' },
};

// ---------- 무기 ----------
// diep.io 탱크처럼 무기마다 진화 트리가 있습니다. 진화한 무기는 '별개의 무기'이고, 능력치가 더 강해집니다.
// 모든 단계의 무기(속성 있음/없음)를 상자·상점에서 얻을 수 있습니다. 시작 무기는 모두 권총.
//
// fam: 계열 (우클릭 스킬·패시브·궁극기를 공유) · tier: 단계 1~3 · evo: 다음 단계
// kind: ranged(총알) / melee(부채꼴) / slam(앞쪽 원형 범위)
// dmg 피해 · cd 공격 간격(초) · crit 치명타율 · critX 치명타 배율 · inacc 탄 퍼짐(명중률) · mana 한 발당 마나
// barrels: 나란히 나가는 총구 (옆으로 떨어진 거리) · pellets/spread: 산탄 · pierce 관통 · blast 폭발 반경 · minCd 최소 간격
export const WEAPONS = {
  // 총 계열
  pistol: { fam: 'gun', tier: 1, name: '권총', kind: 'ranged', dmg: 2, cd: 0.4, crit: 0.05, inacc: 0.06, mana: 0, speed: 620, life: 1.0, evo: ['twin', 'machinegun', 'rifle', 'shotgun'] },
  twin: { fam: 'gun', tier: 2, name: '쌍권총', kind: 'ranged', dmg: 1.8, cd: 0.38, crit: 0.05, inacc: 0.05, mana: 1, speed: 640, life: 1.0, barrels: [-6, 6], evo: ['triplet'] },
  machinegun: { fam: 'gun', tier: 2, name: '기관총', kind: 'ranged', dmg: 1.1, cd: 0.12, crit: 0.04, inacc: 0.24, mana: 0.4, speed: 600, life: 0.95, evo: ['minigun'] },
  rifle: { fam: 'gun', tier: 2, name: '소총', kind: 'ranged', dmg: 4.5, cd: 0.6, minCd: 0.45, crit: 0.12, inacc: 0.01, mana: 2, speed: 980, pierce: 1, life: 1.2, evo: ['sniper'] },
  shotgun: { fam: 'gun', tier: 2, name: '샷건', kind: 'ranged', dmg: 1.2, cd: 0.95, minCd: 0.75, crit: 0.05, inacc: 0.1, mana: 3, speed: 620, life: 0.38, pellets: 6, spread: 0.55, falloff: true, evo: ['combatshotgun'] },
  triplet: { fam: 'gun', tier: 3, name: '삼연발총', kind: 'ranged', dmg: 2.2, cd: 0.36, crit: 0.06, inacc: 0.05, mana: 1.5, speed: 660, life: 1.05, barrels: [-9, 0, 9] },
  minigun: { fam: 'gun', tier: 3, name: '미니건', kind: 'ranged', dmg: 1.3, cd: 0.065, crit: 0.04, inacc: 0.28, mana: 0.35, speed: 640, life: 0.95 },
  sniper: { fam: 'gun', tier: 3, name: '저격총', kind: 'ranged', dmg: 10, cd: 1.1, minCd: 0.9, crit: 0.3, critX: 3, inacc: 0, mana: 4, speed: 1400, pierce: 2, life: 1.4 },
  combatshotgun: { fam: 'gun', tier: 3, name: '전투 샷건', kind: 'ranged', dmg: 1.5, cd: 0.8, minCd: 0.65, crit: 0.06, inacc: 0.1, mana: 4, speed: 660, life: 0.42, pellets: 9, spread: 0.65, falloff: true },
  // 활 계열
  bow: { fam: 'bow', tier: 1, name: '활', kind: 'ranged', dmg: 2.5, cd: 0.5, crit: 0.12, inacc: 0.03, mana: 0, speed: 760, pierce: 1, life: 0.9, evo: ['longbow', 'crossbow', 'rapidbow'] },
  longbow: { fam: 'bow', tier: 2, name: '장궁', kind: 'ranged', dmg: 4.5, cd: 0.65, crit: 0.15, inacc: 0.02, mana: 1.5, speed: 950, pierce: 2, life: 1.2, evo: ['heavenbow'] },
  crossbow: { fam: 'bow', tier: 2, name: '쇠뇌', kind: 'ranged', dmg: 6, cd: 1.0, minCd: 0.7, crit: 0.15, inacc: 0.01, mana: 3, speed: 900, pierce: 1, life: 0.9, blast: 44, evo: ['repeater'] },
  rapidbow: { fam: 'bow', tier: 2, name: '연사궁', kind: 'ranged', dmg: 1.8, cd: 0.26, crit: 0.12, inacc: 0.06, mana: 0.6, speed: 780, pierce: 1, life: 0.85, evo: ['stormbow'] },
  heavenbow: { fam: 'bow', tier: 3, name: '천궁', kind: 'ranged', dmg: 7, cd: 0.7, crit: 0.2, inacc: 0.01, mana: 2.5, speed: 1100, pierce: 4, life: 1.3 },
  repeater: { fam: 'bow', tier: 3, name: '연발 쇠뇌', kind: 'ranged', dmg: 5, cd: 1.0, minCd: 0.75, crit: 0.15, inacc: 0.02, mana: 4, speed: 920, pierce: 1, life: 0.9, blast: 40, pellets: 3, spread: 0.3 },
  stormbow: { fam: 'bow', tier: 3, name: '폭풍궁', kind: 'ranged', dmg: 2, cd: 0.2, crit: 0.12, inacc: 0.06, mana: 0.7, speed: 820, pierce: 1, life: 0.9, barrels: [-5, 5] },
  // 검 계열
  sword: { fam: 'sword', tier: 1, name: '검', kind: 'melee', dmg: 2.5, cd: 0.3, crit: 0.08, range: 52, arc: 1.9, knock: 14, evo: ['greatsword', 'twinblades'] },
  greatsword: { fam: 'sword', tier: 2, name: '대검', kind: 'melee', dmg: 5, cd: 0.5, crit: 0.08, range: 66, arc: 2.2, knock: 24, evo: ['zanbato'] },
  twinblades: { fam: 'sword', tier: 2, name: '쌍검', kind: 'melee', dmg: 1.7, cd: 0.15, crit: 0.15, range: 50, arc: 1.8, knock: 6, evo: ['bladestorm'] },
  zanbato: { fam: 'sword', tier: 3, name: '참마도', kind: 'melee', dmg: 8.5, cd: 0.55, crit: 0.1, range: 82, arc: 2.4, knock: 30 },
  bladestorm: { fam: 'sword', tier: 3, name: '칼날폭풍', kind: 'melee', dmg: 2, cd: 0.1, crit: 0.18, range: 56, arc: 2.0, knock: 6 },
  // 창 계열
  spear: { fam: 'spear', tier: 1, name: '창', kind: 'melee', dmg: 2.5, cd: 0.42, crit: 0.1, range: 92, arc: 0.5, knock: 10, evo: ['halberd', 'lance'] },
  halberd: { fam: 'spear', tier: 2, name: '할버드', kind: 'melee', dmg: 4, cd: 0.5, crit: 0.1, range: 96, arc: 1.1, knock: 24, evo: ['trident'] },
  lance: { fam: 'spear', tier: 2, name: '랜스', kind: 'melee', dmg: 3, cd: 0.34, crit: 0.12, range: 112, arc: 0.45, knock: 12, evo: ['dragonlance'] },
  trident: { fam: 'spear', tier: 3, name: '삼지창', kind: 'melee', dmg: 6, cd: 0.46, crit: 0.12, range: 106, arc: 1.3, knock: 24 },
  dragonlance: { fam: 'spear', tier: 3, name: '드래곤 랜스', kind: 'melee', dmg: 4.5, cd: 0.28, crit: 0.14, range: 132, arc: 0.5, knock: 14 },
  // 해머 계열
  hammer: { fam: 'hammer', tier: 1, name: '해머', kind: 'slam', dmg: 4.5, cd: 0.8, crit: 0.05, reach: 36, radius: 58, knock: 40, evo: ['warhammer', 'quakehammer'] },
  warhammer: { fam: 'hammer', tier: 2, name: '워해머', kind: 'slam', dmg: 7.5, cd: 0.85, crit: 0.06, reach: 32, radius: 50, knock: 34, evo: ['titanhammer'] },
  quakehammer: { fam: 'hammer', tier: 2, name: '지진 망치', kind: 'slam', dmg: 5, cd: 0.9, crit: 0.05, reach: 36, radius: 76, knock: 40, evo: ['earthshaker'] },
  titanhammer: { fam: 'hammer', tier: 3, name: '거인의 망치', kind: 'slam', dmg: 12, cd: 0.9, crit: 0.07, reach: 34, radius: 58, knock: 40 },
  earthshaker: { fam: 'hammer', tier: 3, name: '대지 분쇄기', kind: 'slam', dmg: 6.5, cd: 0.9, crit: 0.05, reach: 36, radius: 96, knock: 46 },
};
export const START_WEAPON = 'pistol';
export const weaponFam = (key) => WEAPONS[key]?.fam || 'gun';
export const TIER_NAME = ['', '1단계', '2단계', '3단계'];

// 무기 능력치 요약 (줍기 전·상점에서 보여 줌)
export function weaponInfo(key) {
  const W = WEAPONS[key];
  const shots = (W.pellets || 1) * (W.barrels?.length || 1);
  return {
    dmg: W.dmg, shots, aps: Math.round((1 / W.cd) * 10) / 10,
    crit: Math.round((W.crit || 0) * 100), critX: W.critX || 2,
    acc: W.kind === 'ranged' ? Math.max(0, Math.round(100 - (W.inacc || 0) * 150)) : 100,
    mana: W.mana || 0, pierce: W.pierce || 0, blast: W.blast || 0, falloff: !!W.falloff,
    range: W.kind === 'ranged' ? Math.round(W.speed * W.life / 10) * 10 : W.range || W.radius,
  };
}

// 계열별 스킬 (우클릭 기본 스킬 / 패시브 / Q 궁극기)
// ult.type: stack(적중·처치 횟수) / gauge(피해량) / time(전투 시간)
export const SKILLS = {
  sword: {
    skill: { name: '돌진 베기', cd: 6, desc: '조준 방향으로 돌진하며 지나간 적 베기, 돌진 중 무적' },
    passive: { name: '반격 자세', desc: '총알을 베어 막을 때마다 다음 공격 피해 +1 (최대 3)' },
    ult: { name: '검기 폭풍', type: 'stack', need: 30, unit: '적중', desc: '3초간 회전 베기 + 사방으로 검기 발사' },
  },
  spear: {
    skill: { name: '투창', cd: 7, desc: '창을 던져 관통, 다시 우클릭하면 회수하며 한 번 더 피해' },
    passive: { name: '창끝 일격', desc: '사거리 끝부분으로 맞히면 피해 +50%' },
    ult: { name: '천 개의 창', type: 'gauge', need: 40, unit: '피해', desc: '2초간 앞쪽 긴 직선을 연속 찌르기' },
  },
  hammer: {
    skill: { name: '지면 강타', cd: 9, desc: '주변 큰 원에 피해 + 1초 기절' },
    passive: { name: '강철 몸', desc: '들고 있는 동안 최대 체력 +2' },
    ult: { name: '대지 분쇄', type: 'gauge', need: 40, unit: '주고받은 피해', desc: '3번 연속 내려찍기, 갈수록 충격파가 커짐' },
  },
  bow: {
    skill: { name: '백스텝 사격', cd: 5, desc: '뒤로 뛰며 부채꼴로 화살 5발' },
    passive: { name: '약점 포착', desc: '같은 적을 연속으로 맞히면 피해 +1씩 (최대 +3)' },
    ult: { name: '화살비', type: 'time', need: 30, unit: '초', desc: '마우스 위치에 3초간 화살비' },
  },
  gun: {
    skill: { name: '수류탄', cd: 8, desc: '마우스 위치로 던져 1초 뒤 범위 폭발' },
    passive: { name: '연발 가속', desc: '계속 쏘면 연사 속도 증가 (최대 +40%)' },
    ult: { name: '난사', type: 'stack', need: 15, unit: '처치', desc: '5초간 연사 속도 3배 (마나 소모 없음)' },
  },
};

export const WEAPON_SLOTS = 2;      // 무기 칸 (스테이지 보상 '무기 벨트'로 3칸)
export const SWAP_COOLDOWN = 1.5;
export const RESONANCE = { dmg: 1.2, ult: 1.25 };  // 무기 속성 = 캐릭터 속성 (공명)
export const COMBO_EVERY = 3;                      // 무기 속성 ≠ 캐릭터 속성 (결합): 3번째 공격마다 캐릭터 속성도 함께

// 무기가 상자·상점에서 나올 때 단계 확률 (월드별)
export const DROP_TIERS = [[0.65, 0.32, 0.03], [0.3, 0.52, 0.18], [0.12, 0.48, 0.4]];
export const DROP_ELEMENT_CHANCE = 0.5;

// ---------- 캐릭터 (로비 동상에서 고름) ----------
export const CHARACTERS = {
  knight: { name: '기사', hp: 7, mana: 90, color: '#90a4ae', passive: '방패', desc: '4초마다 적 탄환 1발을 막는 보호막' },
  ranger: { name: '레인저', hp: 5, mana: 110, color: '#81c784', passive: '날렵함', desc: '이동 속도 +15%, 대시 쿨타임 -30%' },
  mage: { name: '마법사', hp: 4, mana: 170, color: '#9575cd', passive: '마력 증폭', desc: '장착 스킬 피해 +40%, 마나 구슬 +50%' },
  berserker: { name: '광전사', hp: 9, mana: 60, color: '#e57373', passive: '분노', desc: '잃은 체력 1칸마다 피해 +8%' },
  rogue: { name: '도적', hp: 5, mana: 90, color: '#ffd54f', passive: '급소 찌르기', desc: '치명타율 +15%, 치명타 피해 +50%' },
  alchemist: { name: '연금술사', hp: 6, mana: 120, color: '#4db6ac', passive: '촉매', desc: '원소 반응 피해 +60%, 반응을 일으키면 마나 +3' },
};
export const CHARACTER_KEYS = Object.keys(CHARACTERS);
// 같은 캐릭터를 고를 수 있는 최대 인원: 2인 이하 1명, 3~4인 2명
export const sameCharLimit = (playerCount) => (playerCount <= 2 ? 1 : 2);

// ---------- 적 ----------
// gold: 떨어뜨리는 동전 · mp: 떨어뜨리는 마나 구슬 · from: 처음 나오는 스테이지(0부터)
export const ENEMY_TYPES = {
  slime: { name: '슬라임', r: 13, hp: 3, speed: 85, touch: 1, score: 10, gold: 2, xp: 2, mp: 6, from: 0 },
  bat: { name: '박쥐', r: 9, hp: 1.6, speed: 150, touch: 1, score: 8, gold: 1, xp: 1, mp: 4, from: 0 },
  archer: { name: '해골 궁수', r: 12, hp: 2.5, speed: 95, fireEvery: 1.7, bulletSpeed: 260, score: 15, gold: 3, xp: 3, mp: 6, from: 1 },
  spider: { name: '거미', r: 11, hp: 2.5, speed: 80, touch: 1, score: 12, gold: 2, xp: 2, mp: 5, from: 2 },
  bomber: { name: '폭탄 고블린', r: 12, hp: 2.5, speed: 125, touch: 0, score: 14, gold: 3, xp: 2, mp: 6, from: 2 },
  brute: { name: '오크 브루트', r: 18, hp: 9, speed: 60, touch: 2, score: 30, gold: 6, xp: 6, mp: 10, from: 3 },
  bigslime: { name: '큰 슬라임', r: 18, hp: 7, speed: 65, touch: 1, score: 20, gold: 4, xp: 4, mp: 8, from: 4 },
  caster: { name: '해골 마법사', r: 12, hp: 3.5, speed: 70, fireEvery: 2.4, bulletSpeed: 170, score: 22, gold: 4, xp: 4, mp: 10, from: 5 },
  shield: { name: '방패병', r: 16, hp: 8, speed: 55, touch: 2, score: 25, gold: 5, xp: 5, mp: 8, from: 6 },
  totem: { name: '저주 토템', r: 14, hp: 7, speed: 0, fireEvery: 0.45, bulletSpeed: 170, score: 25, gold: 5, xp: 5, mp: 10, from: 7 },
  elite: { name: '정예 오크', r: 26, hp: 45, speed: 75, touch: 2, score: 120, gold: 20, xp: 20, mp: 20, from: 99 },
  boss: { name: '보스', r: 34, hp: 0, speed: 70, touch: 2, score: 300, gold: 40, xp: 30, mp: 60, from: 99 },
};
// 정수(로비에서 스킬 트리를 해금하는 재화): 처치하면 모든 플레이어가 똑같이 받음
export const ESSENCE = { elite: 6, default: 0.6, brute: 2, bigslime: 1.5, shield: 2, totem: 2, boss: 30, room: 2, stage: 8, wave: 1 };

// 월드마다 다른 보스 (x-5 스테이지). patterns: 보스마다 쓰는 공격 (game.js의 BOSS_PATTERNS)
export const BOSSES = [
  { name: '거대 슬라임', color: '#66bb6a', hp: 240, patterns: ['jump', 'ring', 'fan', 'summon', 'puddle', 'bounce'] },
  { name: '해골 궁수 대장', color: '#9575cd', hp: 360, patterns: ['volley', 'arrowRain', 'teleport', 'homing', 'summon', 'spiral', 'wall'] },
  { name: '심연의 골렘', color: '#e57373', hp: 520, patterns: ['laser', 'shockwave', 'rock', 'charge', 'arrowRain', 'sweep', 'ring'] },
];

// ---------- 베이스캠프 = 생존 모드 (탕탕특공대 방식) ----------
// 10분 버티기: 적이 끊임없이 몰려오고, 2:30·5:00·7:30에 정예, 10:00에 보스. 보스를 잡으면 승리.
export const SURVIVAL = {
  prep: 15,              // 시작 준비 시간 (G로 건너뛰기)
  duration: 600,         // 보스가 나오는 시각
  elites: [150, 300, 450],
  maxEnemies: 150,
  chestEvery: 120,       // 캠프 옆에 상자
  reviveTime: 20,        // 쓰러지면 20초 뒤 캠프에서 부활
  hpMul: 0.7,            // 적 하나하나는 약하게, 대신 많이
  bonusHp: 3,            // 생존 모드 시작 체력 보너스
};

// 자동 스킬 (레벨업 카드로 얻음, 혼자 발동). Lv1~5, Lv5 + 짝 패시브가 있으면 진화 카드가 나옴
export const AUTO_SKILLS = {
  blade: { name: '회전 칼날', evoName: '폭풍 칼날', pair: 'swift', color: '#e0f7fa', desc: '몸 주위를 도는 칼날', evoDesc: '칼날 6개가 멈추지 않고 돎' },
  drone: { name: '드론', evoName: '드론 편대', pair: 'haste', color: '#80deea', desc: '가까운 적을 쏘는 드론', evoDesc: '드론 4대가 빠르게 연사' },
  molotov: { name: '화염병', evoName: '지옥불', pair: 'area', color: '#ff7043', desc: '적에게 던져 불바다', evoDesc: '넓고 오래 타는 불바다 5개' },
  lightning: { name: '낙뢰', evoName: '천둥신', pair: 'power', color: '#fff176', desc: '무작위 적에게 번개', evoDesc: '번개가 주변 적에게 연쇄' },
  boomerang: { name: '부메랑', evoName: '원반 폭풍', pair: 'magnet', color: '#ffcc80', desc: '날아갔다 돌아오며 관통', evoDesc: '사방으로 부메랑 6개' },
  aura: { name: '역장', evoName: '수호 역장', pair: 'vitality', color: '#b39ddb', desc: '주변 적에게 계속 피해', evoDesc: '더 넓고 적을 둔화, 가끔 체력 회복' },
};
export const PASSIVE_ITEMS = {
  power: { name: '힘의 반지', desc: '모든 피해 +10%' },
  haste: { name: '가속기', desc: '자동 스킬·무기 스킬 쿨타임 -8%' },
  area: { name: '확장기', desc: '자동 스킬 범위 +10%' },
  magnet: { name: '자석', desc: '구슬 줍는 거리 +30%' },
  vitality: { name: '심장', desc: '최대 체력 +1' },
  swift: { name: '날개 신발', desc: '이동 속도 +6%' },
};
export const AUTO_MAX_LV = 5;
export const AUTO_SLOTS = 6;
export const PASSIVE_SLOTS_RUN = 6;

// ---------- 함정 (던전 전투 방·캠프 바깥) ----------
// 플레이어와 적 모두 맞습니다. 적을 함정으로 유인해 보세요.
export const TRAPS = {
  spike: { name: '가시 함정', cycle: 2.4, warn: 1.2, on: 1.6, dmg: 1, edmg: 3 },
  vent: { name: '화염 분사구', cycle: 3.2, warn: 1.6, on: 2.2, len: 96, w: 24, dmg: 1, edmg: 2 },
  poison: { name: '독 웅덩이', r: 40, dmg: 1, every: 2, slow: 0.75 },
  barrel: { name: '폭발 통', hp: 2, r: 90, dmg: 1, edmg: 8 },
};

// ---------- 베이스캠프 건물 ----------
export const STRUCTS = {
  fence: { name: '울타리', cost: 5, hp: 10 },
  turret: { name: '터렛', cost: 30, hp: 6, range: 280, fireEvery: 0.45, bulletSpeed: 520 },
};

// ---------- 상점 (모험 모드의 상점방) ----------
// 동전은 플레이어마다 따로 줍고, 상품은 먼저 산 사람이 가져갑니다.
export const SHOP = {
  weapon: [0, 25, 55, 100],  // 단계별 무기 가격 (속성 있으면 +12)
  elementExtra: 12,
  heal: { name: '체력 물약', price: 20, desc: '체력 +3' },
  mana: { name: '마나 물약', price: 15, desc: '마나 +60' },
  card: { name: '증강 두루마리', price: 45, desc: '증강 카드 1장 고르기' },
};

// ---------- 증강 (레벨업할 때 3장 중 1장, 그 판에서만 유지) ----------
export const BUFFS = {
  dmg: { name: '공격력 강화', desc: '피해 +12%', max: 5 },
  rate: { name: '빠른 손', desc: '공격 속도 +8%', max: 5 },
  crit: { name: '날카로운 눈', desc: '치명타율 +5%', max: 4 },
  multi: { name: '멀티샷', desc: '총알 +1발 (추가 총알은 피해 50%)', max: 2, ranged: true },
  speed: { name: '날쌘 발', desc: '이동 속도 +6%', max: 4 },
  hp: { name: '튼튼한 몸', desc: '최대 체력 +1', max: 5 },
  mana: { name: '마나 그릇', desc: '최대 마나 +25, 마나 구슬 +15%', max: 3 },
  pierce: { name: '관통탄', desc: '적을 1명 더 관통', max: 2, ranged: true },
  bounce: { name: '도탄', desc: '벽에 1번 더 튕김', max: 2, ranged: true },
  dash: { name: '그림자 대시', desc: '대시 쿨타임 -12%', max: 3 },
  reach: { name: '긴 팔', desc: '근접 공격 범위 +10%', max: 3, melee: true },
};

// ---------- 속성 ----------
export const ELEMENTS = {
  fire: { name: '불', color: '#ff7043', desc: '화상(지속 피해)' },
  water: { name: '물', color: '#42a5f5', desc: '젖음(둔화), 전기·얼음과 반응' },
  electric: { name: '전기', color: '#fff176', desc: '주변 적에게 연쇄 번개' },
  ice: { name: '얼음', color: '#b2ebf2', desc: '둔화, 3번 맞히면 빙결' },
  wind: { name: '바람', color: '#dcedc8', desc: '넉백·상태이상 확산' },
  poison: { name: '독', color: '#9ccc65', desc: '중독(중첩 지속 피해)' },
};
export const ELEMENT_MAX = 3;        // 무기 속성 최대 레벨 (증강 카드)
export const ELEMENT_MAX_BONUS = 5;  // 캐릭터 속성 최대 레벨 (스킬 트리 숙련 + 스테이지 보상)
export const MAX_AUGMENT_TYPES = 5;  // 한 판에 가질 수 있는 증강 종류 수 (속성 카드도 1종류)
export const elColor = (el) => ELEMENTS[el]?.color || '#ffffff';

// 두 속성을 섞었을 때 일어나는 반응 이름 (결합 효과 설명용)
export function reactionName(a, b) {
  const s = new Set([a, b]);
  if (s.has('water') && s.has('electric')) return '감전';
  if (s.has('water') && s.has('ice')) return '빙결';
  if (s.has('fire') && s.has('ice')) return '녹임';
  if (s.has('fire') && s.has('water')) return '증발';
  if (s.has('fire') && s.has('poison')) return '폭발';
  if (s.has('wind')) return '확산';
  return '이중 속성';
}

// ---------- 스테이지 보상 (모험 모드에서 포털을 탈 때, 경험치보다 강력) ----------
// 종류마다 한 판에 1번만 얻을 수 있습니다. 남은 게 3개보다 적으면 '휴식'(반복 가능)으로 채웁니다.
export const STAGE_REWARDS = {
  vamp: { name: '흡혈', desc: '적 처치 시 15% 확률로 체력 +1', color: '#e53935' },
  slot: { name: '무기 벨트', desc: '무기 칸 +1 (3칸)', color: '#a1887f' },
  focus: { name: '집중', desc: '장착 스킬 쿨타임 -25%', color: '#7986cb' },
  phoenix: { name: '불사조의 깃털', desc: '쓰러지면 한 번, 체력 절반으로 바로 부활', color: '#ff8a65' },
  coin: { name: '행운의 동전', desc: '정수·동전 획득 +50%', color: '#ffd54f' },
  surge: { name: '궁극 증폭', desc: '궁극기 충전 +30%', color: '#ba68c8' },
  awaken: { name: '속성 각성', desc: '캐릭터 속성 레벨 +1 (없으면 무작위 속성 Lv2)', color: '#ce93d8' },
  heart: { name: '거인의 심장', desc: '최대 체력 +2, 체력 완전 회복', color: '#ef5350' },
  might: { name: '전사의 혼', desc: '피해 +20%', color: '#ffb74d' },
  gale: { name: '질풍', desc: '공격 속도 +20%', color: '#81c784' },
  wisdom: { name: '배움의 서', desc: '경험치 획득 +50%', color: '#4fc3f7' },
  iron: { name: '철의 의지', desc: '피격 후 무적 시간 2배, 대시 쿨타임 -30%', color: '#b0bec5' },
};
export const REST_REWARD = { name: '휴식', desc: '체력 완전 회복 (반복 가능)', color: '#81c784' };

export const STAGES_PER_WORLD = 5;
export const WORLDS = 3; // 3-5를 깨면 클리어
export const stageLabel = (idx) => `${Math.floor(idx / STAGES_PER_WORLD) + 1}-${(idx % STAGES_PER_WORLD) + 1}`;

export const xpToNext = (level) => 6 + level * 4 + Math.floor((level * level) / 4);

// 몬스터 강화: 스테이지(모험)·웨이브(캠프)가 올라갈수록 체력·피해·탄속이 커집니다.
export const enemyScale = (lvl) => ({ hp: 1 + 0.22 * lvl, dmg: 1 + Math.floor(lvl / 5), shot: 1 + 0.05 * lvl, speed: 1 + 0.02 * lvl });

// 마나: 저절로 차지 않고, 적이 떨어뜨리는 파란 구슬을 주워서 채웁니다 (로비에서는 가득).
// 1단계 무기와 근접 무기, 궁극기는 마나를 쓰지 않습니다.
export const MANA = { weaponSkill: 15 };
export const activeManaCost = (cd) => Math.round(cd * 2.5);

// 스킨: 색만 바꾸는 스킨 + 장비를 입는 스킨(gear: assets/gear.png의 프레임 번호)
export const SKINS = {
  shadow: { name: '그림자', price: 0, body: '#070000', eye: '#ffffff' },
  royal: { name: '왕실', price: 80, body: '#3a1d6e', eye: '#ffd54f' },
  forest: { name: '숲지기', price: 80, body: '#1b5e20', eye: '#c5e1a5' },
  ember: { name: '잿불', price: 120, body: '#7f1d1d', eye: '#ffcc80' },
  frost: { name: '서리', price: 120, body: '#0d3b66', eye: '#b2ebf2' },
  ghost: { name: '유령', price: 180, body: '#cfd8dc', eye: '#263238' },
  gold: { name: '황금', price: 300, body: '#a67c00', eye: '#fff8e1' },
  knight: { name: '중세 기사', price: 250, body: '#5f6b7a', eye: '#ffffff', gear: 0 },
  darkknight: { name: '다크나이트', price: 350, body: '#16141f', eye: '#ff5252', gear: 1 },
  wizard: { name: '대마법사', price: 250, body: '#283593', eye: '#fff59d', gear: 2 },
  samurai: { name: '사무라이', price: 300, body: '#3e2723', eye: '#ffffff', gear: 3 },
};

// 카드 키('dmg', 'el:fire', 'rw:might', 'evo:twin')의 표시용 정보
// weaponName: 지금 들고 있는 무기 이름 (속성 카드 설명에 씀)
export function offerInfo(key, buffs = {}, weaponName = '무기', weaponEl = null, weaponElv = 0, run = {}) {
  if (key.startsWith('au:')) {
    const k = key.slice(3), d = AUTO_SKILLS[k], lv = (run.au?.[k] || 0) + 1;
    return { name: d.name, desc: lv === 1 ? `자동 스킬: ${d.desc} (진화 짝: ${PASSIVE_ITEMS[d.pair].name})` : `${d.desc} 강화`, lv, max: AUTO_MAX_LV, color: d.color };
  }
  if (key.startsWith('pa:')) {
    const k = key.slice(3), d = PASSIVE_ITEMS[k], lv = (run.pa?.[k] || 0) + 1;
    const pairs = Object.values(AUTO_SKILLS).filter((a) => a.pair === k).map((a) => a.name).join(', ');
    return { name: d.name, desc: `${d.desc}${pairs ? ` · ${pairs} 진화 짝` : ''}`, lv, max: AUTO_MAX_LV, color: '#a5d6a7' };
  }
  if (key.startsWith('ev:')) {
    const d = AUTO_SKILLS[key.slice(3)];
    return { name: `진화! ${d.evoName}`, desc: d.evoDesc, lv: null, max: null, color: '#ffd54f' };
  }
  if (key === 'heal') return { name: '고기', desc: '체력 +3 (반복 가능)', lv: null, max: null, color: '#ef9a9a' };
  if (key.startsWith('evo:')) {
    const k = key.slice(4), w = WEAPONS[k], i = weaponInfo(k);
    return {
      name: `진화: ${w.name}`, lv: null, max: null, color: '#ffd54f', weapon: k,
      desc: `피해 ${i.dmg}${i.shots > 1 ? ` x${i.shots}` : ''} · 초당 ${i.aps}회 · 치명 ${i.crit}%`,
    };
  }
  if (key.startsWith('rw:')) {
    const def = key === 'rw:rest' ? REST_REWARD : STAGE_REWARDS[key.slice(3)];
    return { name: def.name, desc: def.desc, lv: null, max: null, color: def.color };
  }
  if (key.startsWith('el:')) {
    const k = key.slice(3), def = ELEMENTS[k];
    const lv = weaponEl === k ? weaponElv + 1 : 1;
    return { name: `${def.name} 속성`, desc: `${weaponName}에 ${def.name} 속성을 추가합니다`, lv, max: ELEMENT_MAX, color: def.color };
  }
  const def = BUFFS[key];
  return { name: def.name, desc: def.desc, lv: (buffs[key] || 0) + 1, max: def.max, color: '#ffd54f' };
}
