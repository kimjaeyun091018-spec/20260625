// 맵 만들기: 베이스캠프 고정 맵 + 모험 모드 랜덤 던전
// 맵 구조: { id, cols, rows, tiles(0 바닥/1 벽 배열), rooms[], camp?, portal? }

import { TILE } from './data.js';

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
let mapSerial = 1;

export const tileCenter = (t) => t * TILE + TILE / 2;

function emptyMap(cols, rows, fill) {
  return { id: mapSerial++, cols, rows, tiles: new Array(cols * rows).fill(fill), rooms: [] };
}

const setTile = (m, x, y, v) => {
  if (x >= 0 && y >= 0 && x < m.cols && y < m.rows) m.tiles[y * m.cols + x] = v;
};

// ---------- 베이스캠프 ----------
export function buildCampMap() {
  const cols = 30, rows = 20;
  const m = emptyMap(cols, rows, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) setTile(m, x, y, 1);
    }
  }
  for (const [bx, by] of [[5, 4], [23, 4], [5, 14], [23, 14]]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setTile(m, bx + dx, by + dy, 1);
  }
  m.camp = { x: 15 * TILE, y: 10 * TILE, r: 6 * TILE };
  m.spawn = { x: 15 * TILE, y: 10 * TILE };
  return m;
}

// ---------- 로비 (걸어 다니는 방) ----------
// 왼쪽: 무기 거치대 5개 · 위: 스킬 트리 제단 · 오른쪽: 모험/베이스캠프 포털 · 아래: 토템 자리
export function buildLobbyMap(weaponKeys) {
  const m = buildCampMap();
  m.camp = undefined;
  // 가운데 기둥은 로비에서 치움
  for (const [bx, by] of [[5, 4], [23, 4], [5, 14], [23, 14]]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) setTile(m, bx + dx, by + dy, 0);
  }
  m.lobby = {
    racks: weaponKeys.map((key, i) => ({ key, x: 4 * TILE, y: (4 + i * 3) * TILE })),
    altar: { x: 15 * TILE, y: 3.5 * TILE },
    portals: [
      { mode: 'adv', name: '모험', x: 25 * TILE, y: 6.5 * TILE, color: '#b39ddb' },
      { mode: 'camp', name: '베이스캠프', x: 25 * TILE, y: 13.5 * TILE, color: '#ffb74d' },
    ],
    totems: [0, 1, 2].map((i) => ({ x: (12 + i * 3) * TILE, y: 17 * TILE })),
  };
  m.spawn = { x: 15 * TILE, y: 10 * TILE };
  return m;
}

// ---------- 랜덤 던전 ----------
// 5x5 칸 격자 위에 방을 나무 모양으로 이어 붙이고, 이웃한 방끼리 3칸 폭 복도로 연결합니다.
const GRID = 5;
const CELL = 22; // 한 칸 = 22x22 타일

export function generateDungeon(stageIdx, { roomBonus = 0, boss = false } = {}) {
  const roomCount = Math.min(5 + Math.floor(stageIdx / 2) + roomBonus, GRID * GRID - 4);
  const cells = new Map();
  const key = (x, y) => `${x},${y}`;
  const first = { gx: rand(1, 3), gy: rand(1, 3), links: [] };
  cells.set(key(first.gx, first.gy), first);
  const list = [first];

  for (let guard = 0; list.length < roomCount && guard < 2000; guard++) {
    // 끝쪽 방에서 뻗어 나갈수록 길쭉한 던전이 됩니다.
    const a = Math.random() < 0.6 ? list[list.length - 1 - rand(0, Math.min(2, list.length - 1))] : list[rand(0, list.length - 1)];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5);
    for (const [dx, dy] of dirs) {
      const nx = a.gx + dx, ny = a.gy + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || cells.has(key(nx, ny))) continue;
      const b = { gx: nx, gy: ny, links: [] };
      a.links.push(b);
      b.links.push(a);
      cells.set(key(nx, ny), b);
      list.push(b);
      break;
    }
  }

  // 시작 방에서 가장 먼 방 = 포털 방
  const dist = new Map([[first, 0]]);
  const queue = [first];
  while (queue.length) {
    const c = queue.shift();
    for (const n of c.links) if (!dist.has(n)) { dist.set(n, dist.get(c) + 1); queue.push(n); }
  }
  const last = list.reduce((best, c) => (dist.get(c) > dist.get(best) ? c : best), first);

  const m = emptyMap(GRID * CELL, GRID * CELL, 1);
  list.forEach((c, i) => {
    const type = c === first ? 'start' : c === last ? (boss ? 'boss' : 'portal') : 'battle';
    const small = type === 'start' || type === 'portal';
    const w = type === 'boss' ? 17 : small ? 9 : rand(11, 15);
    const h = type === 'boss' ? 15 : small ? 9 : rand(9, 13);
    c.room = {
      id: i, type, gx: c.gx, gy: c.gy,
      x0: c.gx * CELL + Math.floor((CELL - w) / 2),
      y0: c.gy * CELL + Math.floor((CELL - h) / 2),
      w, h, doors: [], links: [],
    };
    m.rooms.push(c.room);
  });

  for (const r of m.rooms) {
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) setTile(m, x, y, 0);
  }

  // 복도 + 문(방 테두리 바로 바깥의 복도 칸)
  const done = new Set();
  for (const a of list) {
    for (const b of a.links) {
      const id = [a.room.id, b.room.id].sort().join('-');
      if (done.has(id)) continue;
      done.add(id);
      a.room.links.push(b.room.id);
      b.room.links.push(a.room.id);
      carveCorridor(m, a.room, b.room);
    }
  }

  // 전투 방에는 엄폐용 기둥
  for (const r of m.rooms) {
    if (r.type !== 'battle') continue;
    const cx = r.x0 + Math.floor(r.w / 2), cy = r.y0 + Math.floor(r.h / 2);
    for (let n = rand(2, 4), guard = 0; n > 0 && guard < 50; guard++) {
      const s = Math.random() < 0.5 ? 1 : 2;
      const px = rand(r.x0 + 2, r.x0 + r.w - 3 - s), py = rand(r.y0 + 2, r.y0 + r.h - 3 - s);
      if (Math.abs(px - cx) < 3 && Math.abs(py - cy) < 3) continue;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) setTile(m, px + dx, py + dy, 1);
      n--;
    }
  }

  const start = first.room, end = last.room;
  m.spawn = { x: (start.x0 + start.w / 2) * TILE, y: (start.y0 + start.h / 2) * TILE };
  m.portal = { x: (end.x0 + end.w / 2) * TILE, y: (end.y0 + end.h / 2) * TILE };
  m.boss = boss;
  return m;
}

function carveCorridor(m, a, b) {
  const acx = a.x0 + Math.floor(a.w / 2), acy = a.y0 + Math.floor(a.h / 2);
  const bcx = b.x0 + Math.floor(b.w / 2), bcy = b.y0 + Math.floor(b.h / 2);
  if (a.gy === b.gy) {
    const [l, r] = a.gx < b.gx ? [a, b] : [b, a];
    const y = a.gx < b.gx ? acy : bcy;
    const x1 = l.x0 + l.w, x2 = r.x0 - 1;
    for (let x = x1; x <= x2; x++) for (let dy = -1; dy <= 1; dy++) setTile(m, x, y + dy, 0);
    for (let dy = -1; dy <= 1; dy++) {
      l.doors.push([x1, y + dy]);
      r.doors.push([x2, y + dy]);
    }
  } else {
    const [t, btm] = a.gy < b.gy ? [a, b] : [b, a];
    const x = a.gy < b.gy ? acx : bcx;
    const y1 = t.y0 + t.h, y2 = btm.y0 - 1;
    for (let y = y1; y <= y2; y++) for (let dx = -1; dx <= 1; dx++) setTile(m, x + dx, y, 0);
    for (let dx = -1; dx <= 1; dx++) {
      t.doors.push([x + dx, y1]);
      btm.doors.push([x + dx, y2]);
    }
  }
}

// ---------- 네트워크 전송용 ----------
export function packMap(m) {
  return {
    id: m.id, cols: m.cols, rows: m.rows,
    tiles: m.tiles.join(''),
    rooms: m.rooms.map(({ id, type, gx, gy, x0, y0, w, h, doors, links }) => ({ id, type, gx, gy, x0, y0, w, h, doors, links })),
    camp: m.camp || null, spawn: m.spawn, portal: m.portal || null, lobby: m.lobby || null, boss: !!m.boss,
  };
}

export function unpackMap(p) {
  return { ...p, tiles: Array.from(p.tiles, (c) => (c === '1' ? 1 : 0)) };
}
