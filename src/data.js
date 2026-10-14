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
export const WEAPONS = {
  sword: { name: '검', icon: '🗡️', kind: 'melee', dmg: 2, cd: 0.3, range: 52, arc: 1.9, knock: 14, desc: '넓게 베기 · 적 총알을 베어 막음' },
  spear: { name: '창', icon: '🔱', kind: 'melee', dmg: 2, cd: 0.42, range: 92, arc: 0.5, knock: 10, desc: '긴 사거리 찌르기 · 일직선 관통' },
  hammer: { name: '해머', icon: '🔨', kind: 'slam', dmg: 4, cd: 0.8, reach: 36, radius: 58, knock: 40, desc: '느리지만 강한 범위 공격 · 큰 넉백' },
  bow: { name: '활', icon: '🏹', kind: 'ranged', dmg: 2, cd: 0.42, speed: 760, pierce: 1, life: 0.9, desc: '강하고 관통하는 화살' },
  gun: { name: '총', icon: '🔫', kind: 'ranged', dmg: 1, cd: 0.16, speed: 600, pierce: 0, life: 1.1, desc: '빠른 연사' },
};
export const WEAPON_KEYS = Object.keys(WEAPONS);

// 같은 무기를 고를 수 있는 최대 인원: 2인 이하 1명, 3~4인 2명
export const sameWeaponLimit = (playerCount) => (playerCount <= 2 ? 1 : 2);

// ---------- 적 ----------
export const ENEMY_TYPES = {
  slime: { r: 13, hp: 3, speed: 85, touch: 1, score: 10, gold: 3, xp: 2 },
  archer: { r: 12, hp: 2, speed: 95, fireEvery: 1.7, bulletSpeed: 260, score: 15, gold: 4, xp: 3 },
  brute: { r: 18, hp: 9, speed: 60, touch: 2, score: 30, gold: 10, xp: 6 },
};

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
  vamp: { name: '흡혈', desc: '처치 시 12% 확률로 체력 +1', max: 3 },
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

// ---------- 스테이지 보상 (모험 모드에서 포털을 탈 때, 경험치보다 강력) ----------
export const STAGE_REWARDS = {
  awaken: { name: '속성 각성', desc: '속성 레벨 +1 (없으면 무작위 속성 Lv2)', color: '#ce93d8' },
  heart: { name: '거인의 심장', desc: '최대 체력 +3, 체력 완전 회복', color: '#ef5350' },
  might: { name: '전사의 혼', desc: '피해 +2', color: '#ffb74d' },
  gale: { name: '질풍', desc: '공격 속도 +40%, 이동 속도 +10%', color: '#81c784' },
  wisdom: { name: '배움의 서', desc: '경험치 획득 +50%', color: '#4fc3f7' },
  iron: { name: '철의 의지', desc: '피격 후 무적 시간 2배, 대시 쿨타임 -30%', color: '#b0bec5' },
};

export const STAGES_PER_WORLD = 5;
export const WORLDS = 3; // 3-5를 깨면 클리어
export const stageLabel = (idx) => `${Math.floor(idx / STAGES_PER_WORLD) + 1}-${(idx % STAGES_PER_WORLD) + 1}`;

export const xpToNext = (level) => 4 + level * 3;

// 카드 키('dmg', 'el:fire', 'rw:might')의 표시용 정보
export function offerInfo(key, buffs = {}, element = null, elementLv = 0) {
  if (key.startsWith('rw:')) {
    const def = STAGE_REWARDS[key.slice(3)];
    return { name: def.name, desc: def.desc, lv: null, max: null, color: def.color };
  }
  if (key.startsWith('el:')) {
    const k = key.slice(3), def = ELEMENTS[k];
    const lv = element === k ? elementLv + 1 : 1;
    const desc = element && element !== k ? `${def.desc} (현재 속성과 교체)` : def.desc;
    return { name: `${def.name} 속성`, desc, lv, max: ELEMENT_MAX, color: def.color };
  }
  const def = BUFFS[key];
  return { name: def.name, desc: def.desc, lv: (buffs[key] || 0) + 1, max: def.max, color: '#ffd54f' };
}
