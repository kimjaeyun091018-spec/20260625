// 게임 데이터(수치) 모음 — 밸런스는 대부분 여기서 조절합니다.

export const TILE = 32;
export const VIEW_W = 960;   // 화면(캔버스) 크기
export const VIEW_H = 640;
export const MAX_PLAYERS = 4;

export const MODES = {
  camp: { name: '베이스캠프', desc: '중앙 캠프에 울타리·터렛을 짓고 끝없는 웨이브를 버티기' },
  adv: { name: '모험', desc: '랜덤 던전의 방을 하나씩 정복하고 포털로 다음 스테이지로' },
};

// ---------- 무기 ----------
// kind: ranged(총알) / melee(부채꼴 베기·찌르기) / slam(앞쪽 원형 범위)
// fam: 계열 — 같은 계열은 기본 스킬·패시브·궁극기를 공유하고, 전직하면 기본 공격과 특성이 바뀝니다.
export const WEAPONS = {
  // 1단계 (로비에서 고르는 기본 무기)
  sword: { fam: 'sword', tier: 1, name: '검', icon: '🗡️', kind: 'melee', dmg: 2, cd: 0.3, range: 52, arc: 1.9, knock: 14, desc: '넓게 베기 · 적 총알을 베어 막음', evo: ['greatsword', 'twinblades'] },
  spear: { fam: 'spear', tier: 1, name: '창', icon: '🔱', kind: 'melee', dmg: 2, cd: 0.42, range: 92, arc: 0.5, knock: 10, desc: '긴 사거리 찌르기 · 일직선 관통', evo: ['halberd', 'lance'] },
  hammer: { fam: 'hammer', tier: 1, name: '해머', icon: '🔨', kind: 'slam', dmg: 4, cd: 0.8, reach: 36, radius: 58, knock: 40, desc: '느리지만 강한 범위 공격 · 큰 넉백', evo: ['warhammer', 'quakehammer'] },
  bow: { fam: 'bow', tier: 1, name: '활', icon: '🏹', kind: 'ranged', dmg: 2, cd: 0.42, speed: 760, pierce: 1, life: 0.9, desc: '강하고 관통하는 화살', evo: ['crossbow', 'longbow'] },
  gun: { fam: 'gun', tier: 1, name: '총', icon: '🔫', kind: 'ranged', dmg: 1, cd: 0.16, speed: 600, pierce: 0, life: 1.1, desc: '빠른 연사', evo: ['shotgun', 'sniper'] },
  // 2단계 (스테이지를 넘어갈 때 전직)
  greatsword: { fam: 'sword', tier: 2, name: '대검', kind: 'melee', dmg: 4, cd: 0.5, range: 66, arc: 2.2, knock: 24, parry: 2, desc: '느리지만 피해·범위 증가, 탄 막기 범위 2배' },
  twinblades: { fam: 'sword', tier: 2, name: '쌍검', kind: 'melee', dmg: 1, cd: 0.14, range: 48, arc: 1.7, knock: 6, charges: 2, desc: '공격 속도 2배, 돌진 베기 2회 충전' },
  halberd: { fam: 'spear', tier: 2, name: '할버드', kind: 'melee', dmg: 3, cd: 0.5, range: 92, arc: 1.1, knock: 24, desc: '찌르기에 베기를 더해 넓어진 범위, 넉백 증가' },
  lance: { fam: 'spear', tier: 2, name: '랜스', kind: 'melee', dmg: 2, cd: 0.42, range: 96, arc: 0.5, knock: 12, dashHit: 3, skillCd: 4, desc: '대시로 부딪힌 적에게 피해, 투창 쿨타임 감소' },
  warhammer: { fam: 'hammer', tier: 2, name: '워해머', kind: 'slam', dmg: 6, cd: 0.85, reach: 30, radius: 44, knock: 30, execute: 0.2, desc: '단일 피해 극대화, 체력 20% 이하 적 즉시 처치' },
  quakehammer: { fam: 'hammer', tier: 2, name: '지진 망치', kind: 'slam', dmg: 4, cd: 0.9, reach: 36, radius: 58, knock: 36, quake: true, desc: '내려찍을 때마다 사방으로 진동파' },
  crossbow: { fam: 'bow', tier: 2, name: '쇠뇌', kind: 'ranged', dmg: 5, cd: 0.9, speed: 900, pierce: 2, life: 0.9, blast: 44, desc: '느리지만 강한 볼트, 맞은 자리에서 작은 폭발' },
  longbow: { fam: 'bow', tier: 2, name: '강화 활', kind: 'ranged', dmg: 2, cd: 0.35, speed: 760, pierce: 1, life: 1.1, charge: 1.2, desc: '누르고 있으면 차지, 오래 당길수록 피해·사거리·관통 증가' },
  shotgun: { fam: 'gun', tier: 2, name: '샷건', kind: 'ranged', dmg: 1, cd: 0.55, speed: 620, pierce: 0, life: 0.35, pellets: 5, spread: 0.5, desc: '근거리 산탄 5발' },
  sniper: { fam: 'gun', tier: 2, name: '저격총', kind: 'ranged', dmg: 6, cd: 1.0, speed: 1300, pierce: 1, life: 1.4, crit: 0.25, desc: '느린 단발, 긴 사거리, 25% 확률 치명타 3배' },
};
export const WEAPON_KEYS = Object.keys(WEAPONS).filter((k) => WEAPONS[k].tier === 1);
export const weaponFam = (key) => WEAPONS[key]?.fam || 'gun';

// 계열별 스킬 (우클릭 기본 스킬 / 패시브 / Q 궁극기)
// ult.type: stack(적중·처치 횟수) / gauge(피해량) / time(시간)
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
    ult: { name: '화살비', type: 'time', need: 40, unit: '초', desc: '마우스 위치에 3초간 화살비' },
  },
  gun: {
    skill: { name: '수류탄', cd: 8, desc: '마우스 위치로 던져 1초 뒤 범위 폭발' },
    passive: { name: '연발 가속', desc: '계속 쏘면 연사 속도 증가 (최대 +40%)' },
    ult: { name: '난사', type: 'stack', need: 15, unit: '처치', desc: '5초간 연사 속도 3배' },
  },
};

export const WEAPON_SLOTS = 2;      // 무기 칸 (나중에 강화로 3칸)
export const SWAP_COOLDOWN = 1.5;
export const RESONANCE_ULT = 1.25;  // 무기 속성 = 캐릭터 속성일 때 궁극기 충전 배율
export const CHEST_CHANCE = 0.4;    // 전투 방 클리어 시 보물상자 확률 (스테이지마다 최소 1개)

// 같은 무기를 고를 수 있는 최대 인원: 2인 이하 1명, 3~4인 2명
export const sameWeaponLimit = (playerCount) => (playerCount <= 2 ? 1 : 2);

// ---------- 적 ----------
export const ENEMY_TYPES = {
  slime: { r: 13, hp: 3, speed: 85, touch: 1, score: 10, gold: 3, xp: 2 },
  archer: { r: 12, hp: 2, speed: 95, fireEvery: 1.7, bulletSpeed: 260, score: 15, gold: 4, xp: 3 },
  brute: { r: 18, hp: 9, speed: 60, touch: 2, score: 30, gold: 10, xp: 6 },
  boss: { r: 34, hp: 0, speed: 70, touch: 2, score: 300, gold: 50, xp: 30 },
};
// 정수(로비에서 스킬 트리를 해금하는 재화): 처치하면 모든 플레이어가 똑같이 받음
export const ESSENCE = { slime: 0.5, archer: 1, brute: 2, boss: 30, room: 2, stage: 8, wave: 1 };

// 월드마다 다른 보스 (x-5 스테이지)
export const BOSSES = [
  { name: '거대 슬라임', color: '#66bb6a', hp: 220 },
  { name: '해골 궁수 대장', color: '#9575cd', hp: 340 },
  { name: '심연의 골렘', color: '#e57373', hp: 480 },
];

// ---------- 베이스캠프 건물 ----------
export const STRUCTS = {
  fence: { name: '울타리', cost: 5, hp: 10 },
  turret: { name: '터렛', cost: 30, hp: 6, range: 280, fireEvery: 0.45, bulletSpeed: 520 },
};

// ---------- 증강 (레벨업할 때 3장 중 1장, 그 판에서만 유지) ----------
export const BUFFS = {
  dmg: { name: '공격력 강화', desc: '피해 +1', max: 5 },
  rate: { name: '빠른 손', desc: '공격 속도 +25%', max: 5 },
  multi: { name: '멀티샷', desc: '총알 +1발', max: 3, ranged: true },
  speed: { name: '날쌘 발', desc: '이동 속도 +12%', max: 4 },
  hp: { name: '튼튼한 몸', desc: '최대 체력 +2', max: 5 },
  pierce: { name: '관통탄', desc: '적을 1명 더 관통', max: 3, ranged: true },
  bounce: { name: '도탄', desc: '벽에 1번 더 튕김', max: 3, ranged: true },
  dash: { name: '그림자 대시', desc: '대시 쿨타임 -25%', max: 3 },
  reach: { name: '긴 팔', desc: '근접 공격 범위 +20%', max: 3, melee: true },
};

// ---------- 속성 ----------
export const ELEMENTS = {
  fire: { name: '불', color: '#ff7043', desc: '화상(지속 피해)' },
  water: { name: '물', color: '#42a5f5', desc: '젖음(둔화), 전기·얼음과 반응' },
  electric: { name: '전기', color: '#fff176', desc: '주변 적에게 연쇄 번개' },
  ice: { name: '얼음', color: '#b2ebf2', desc: '둔화, 3번 맞히면 빙결' },
  wind: { name: '바람', color: '#dcedc8', desc: '넉백·상태이상 확산·탄속 증가' },
  poison: { name: '독', color: '#9ccc65', desc: '중독(중첩 지속 피해)' },
};
export const ELEMENT_MAX = 3;        // 증강 카드로 올릴 수 있는 최대 레벨
export const ELEMENT_MAX_BONUS = 5;  // 스테이지 보상까지 포함한 최대 레벨
export const MAX_AUGMENT_TYPES = 5;  // 한 판에 가질 수 있는 증강 종류 수 (속성 카드도 1종류)

// ---------- 스테이지 보상 (모험 모드에서 포털을 탈 때, 경험치보다 강력) ----------
// 종류마다 한 판에 1번만 얻을 수 있습니다. 남은 게 3개보다 적으면 '휴식'(반복 가능)으로 채웁니다.
export const STAGE_REWARDS = {
  vamp: { name: '흡혈', desc: '적 처치 시 15% 확률로 체력 +1', color: '#e53935' },
  slot: { name: '무기 벨트', desc: '무기 칸 +1 (3칸)', color: '#a1887f' },
  focus: { name: '집중', desc: '장착 스킬 쿨타임 -25%', color: '#7986cb' },
  phoenix: { name: '불사조의 깃털', desc: '쓰러지면 한 번, 체력 절반으로 바로 부활', color: '#ff8a65' },
  coin: { name: '행운의 동전', desc: '정수 획득 +50%', color: '#ffd54f' },
  surge: { name: '궁극 증폭', desc: '궁극기 충전 +30%', color: '#ba68c8' },
  awaken: { name: '속성 각성', desc: '속성 레벨 +1 (없으면 무작위 속성 Lv2)', color: '#ce93d8' },
  heart: { name: '거인의 심장', desc: '최대 체력 +3, 체력 완전 회복', color: '#ef5350' },
  might: { name: '전사의 혼', desc: '피해 +2', color: '#ffb74d' },
  gale: { name: '질풍', desc: '공격 속도 +40%, 이동 속도 +10%', color: '#81c784' },
  wisdom: { name: '배움의 서', desc: '경험치 획득 +50%', color: '#4fc3f7' },
  iron: { name: '철의 의지', desc: '피격 후 무적 시간 2배, 대시 쿨타임 -30%', color: '#b0bec5' },
};
export const REST_REWARD = { name: '휴식', desc: '체력 완전 회복 (반복 가능)', color: '#81c784' };

export const STAGES_PER_WORLD = 5;
export const WORLDS = 3; // 3-5를 깨면 클리어
export const stageLabel = (idx) => `${Math.floor(idx / STAGES_PER_WORLD) + 1}-${(idx % STAGES_PER_WORLD) + 1}`;

export const xpToNext = (level) => 4 + level * 3;

// 카드 키('dmg', 'el:fire', 'rw:might')의 표시용 정보
export function offerInfo(key, buffs = {}, element = null, elementLv = 0) {
  if (key.startsWith('evo:')) {
    const w = WEAPONS[key.slice(4)];
    return { name: `전직: ${w.name}`, desc: w.desc, lv: null, max: null, color: '#ffd54f', weapon: key.slice(4) };
  }
  if (key.startsWith('rw:')) {
    const def = key === 'rw:rest' ? REST_REWARD : STAGE_REWARDS[key.slice(3)];
    return { name: def.name, desc: def.desc, lv: null, max: null, color: def.color };
  }
  if (key.startsWith('el:')) {
    const k = key.slice(3), def = ELEMENTS[k];
    const lv = element === k ? elementLv + 1 : 1;
    return { name: `${def.name} 속성`, desc: def.desc, lv, max: ELEMENT_MAX, color: def.color };
  }
  const def = BUFFS[key];
  return { name: def.name, desc: def.desc, lv: (buffs[key] || 0) + 1, max: def.max, color: '#ffd54f' };
}
