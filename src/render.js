// 캔버스 그리기 전담 (게임 규칙 없음)
import {
  TILE, VIEW_W, VIEW_H, STRUCTS, BUFFS, ELEMENTS, WEAPONS, SKILLS, SKINS, MAX_AUGMENT_TYPES, offerInfo, stageLabel, weaponFam,
  CHARACTERS, weaponInfo, elColor, TIER_NAME, SHOP, reactionName, ENEMY_TYPES, TRAPS, SURVIVAL, UNITS, CASTLE,
} from './data.js';
import { CELL } from './maps.js';
import { NODE } from './tree.js';

// tools/make_sprites.py의 WEAPON_ORDER와 같은 순서여야 합니다.
export const WEAPON_SPRITES = [
  'pistol', 'twin', 'machinegun', 'rifle', 'shotgun', 'triplet', 'minigun', 'sniper', 'combatshotgun',
  'bow', 'longbow', 'crossbow', 'rapidbow', 'heavenbow', 'repeater', 'stormbow',
  'sword', 'greatsword', 'twinblades', 'zanbato', 'bladestorm',
  'spear', 'halberd', 'lance', 'trident', 'dragonlance',
  'hammer', 'warhammer', 'quakehammer', 'titanhammer', 'earthshaker',
  'chest', 'chest_open',
  'staff', 'mace',
];
const PIXEL = 2;            // 도트 1칸 = 화면 2픽셀
const GRIP_X = 3, GRIP_Y = 6; // 무기 그림에서 손잡이 위치

// ---------- 이미지 불러오기 ----------
const sprites = { ready: false, heroes: new Image(), weapons: new Image(), enemies: new Image(), bosses: new Image(), castle: new Image(), fence: new Image(), turret: new Image() };
{
  const list = ['heroes', 'weapons', 'enemies', 'bosses', 'castle', 'fence', 'turret'];
  let left = list.length;
  const done = () => {
    if (--left > 0) return;
    sprites.enemiesHit = whiteSilhouette(sprites.enemies);
    sprites.bossesHit = whiteSilhouette(sprites.bosses);
    sprites.ready = true;
  };
  for (const k of list) {
    sprites[k].onload = done;
    sprites[k].src = `assets/${k}.png?v=${window.__ASSET_V || ''}`;
  }
}

// 맞았을 때 하얗게 번쩍이는 버전
function whiteSilhouette(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// 캐릭터 도트: assets/heroes.png (tools/make_heroes.py). 한 줄 = 디자인 하나, 가로 13프레임
// 발밑 고리(254,254,254) → 팀 색, 천 색(7,0,0/1/2) → 스킨·유닛 색, 흰색(눈) → 스킨 눈 색
export const DESIGNS = ['knight', 'ranger', 'mage', 'berserker', 'rogue', 'alchemist', 'scout', 'priest', 'giant', 'darkknight', 'samurai', 'wizard'];
// 디자인마다 기본 천 색 (기본 스킨 '그림자'일 때)
const DESIGN_CLOTH = {
  knight: '#c62828', ranger: '#2e7d32', mage: '#5e35b1', berserker: '#5d4037', rogue: '#b71c1c', alchemist: '#00897b',
  scout: '#795548', priest: '#eceff1', giant: '#4e342e', darkknight: '#b71c1c', samurai: '#263238', wizard: '#283593',
};
// 플레이어가 보일 디자인: 장비 스킨이면 그 장비, 아니면 캐릭터 (스킨은 캐릭터마다 따로)
export const designOf = (charKey, skin) => SKINS[skin]?.design || (DESIGNS.includes(charKey) ? charKey : 'knight');

const tintCache = new Map();
const shade = ([r, g, b], k) => (k > 0 ? [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k] : [r * (1 + k), g * (1 + k), b * (1 + k)]).map(Math.round);
// skin: SKINS의 이름, 또는 { body, eye } 색 (군단 유닛). design: DESIGNS 중 하나
export function tintedPlayer(color, skin = 'shadow', design = 'knight') {
  const S = typeof skin === 'object' ? skin : SKINS[skin] || { eye: '#ffffff' };
  const row = Math.max(0, DESIGNS.indexOf(design));
  const plain = typeof skin !== 'object' && (!S.body || S.design);
  const cloth = plain ? DESIGN_CLOTH[DESIGNS[row]] : S.body;
  const key = `${color}|${cloth}|${S.eye}|${row}`;
  if (tintCache.has(key)) return tintCache.get(key);
  const img = sprites.heroes;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = 32;
  const g = c.getContext('2d');
  g.drawImage(img, 0, row * 32, img.width, 32, 0, 0, img.width, 32);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data, w = c.width, h = c.height;
  const team = hexRgb(color), eye = hexRgb(S.eye || '#ffffff'), base = hexRgb(cloth);
  const clothCols = [base, shade(base, 0.35), shade(base, -0.45)];
  const out = new Uint8ClampedArray(px);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] === 0) continue;
      if (px[i] === 7 && px[i + 1] === 0 && px[i + 2] <= 2) { const cc = clothCols[px[i + 2]]; out[i] = cc[0]; out[i + 1] = cc[1]; out[i + 2] = cc[2]; continue; }
      if (px[i] === 254 && px[i + 1] === 254 && px[i + 2] === 254) { out[i] = team[0]; out[i + 1] = team[1]; out[i + 2] = team[2]; continue; }
      if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) { out[i] = eye[0]; out[i + 1] = eye[1]; out[i + 2] = eye[2]; }
    }
  }
  g.putImageData(new ImageData(out, w, h), 0, 0);
  tintCache.set(key, c);
  return c;
}

// 로비·보상 화면(HTML)에서 쓰는 무기 아이콘
export function weaponIconHtml(key, scale = 2) {
  const i = WEAPON_SPRITES.indexOf(key);
  if (i < 0) return '';
  return `<span class="wsprite" style="width:${24 * scale}px;height:${12 * scale}px;background-size:${WEAPON_SPRITES.length * 24 * scale}px ${12 * scale}px;background-position:-${i * 24 * scale}px 0"></span>`;
}

const ENEMY_COLORS = { slime: '#66bb6a', archer: '#9575cd', brute: '#e57373' };
// 이름 글자색: 무기 속성 색 (속성 없으면 흰색)
const weaponLabel = (k, el) => `${ELEMENTS[el] ? `${ELEMENTS[el].name}의 ` : ''}${WEAPONS[k]?.name ?? ''}`;

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let cardRects = [];
  let showDamage = true;
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- 기본 도형 ----------
  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function hpBar(x, y, w, hp, max) {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x - w / 2, y, w, 4);
    ctx.fillStyle = '#ef5350';
    ctx.fillRect(x - w / 2, y, (w * Math.max(0, hp)) / max, 4);
  }

  // ---------- 카메라 ----------
  // z = 화면 확대 배율 (1.25면 세상이 1.25배 크게 보이고, 보이는 범위는 그만큼 좁아짐)
  function cameraFor(map, focus, z = 1) {
    const vw = VIEW_W / z, vh = VIEW_H / z;
    const mw = map.cols * TILE, mh = map.rows * TILE;
    const cx = mw <= vw ? (mw - vw) / 2 : Math.max(0, Math.min(mw - vw, focus.x - vw / 2));
    const cy = mh <= vh ? (mh - vh) / 2 : Math.max(0, Math.min(mh - vh, focus.y - vh / 2));
    return { x: Math.round(cx), y: Math.round(cy), z };
  }

  // ---------- 맵 ----------
  function drawMap(map, cam, snap) {
    const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(map.cols - 1, Math.floor((cam.x + VIEW_W / cam.z) / TILE));
    const ty1 = Math.min(map.rows - 1, Math.floor((cam.y + VIEW_H / cam.z) / TILE));
    const camp = map.camp;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const px = tx * TILE - cam.x, py = ty * TILE - cam.y;
        if (map.tiles[ty * map.cols + tx]) {
          // 바닥과 닿은 벽만 그려서 던전 바깥은 어둡게 둡니다.
          const below = ty + 1 < map.rows && !map.tiles[(ty + 1) * map.cols + tx];
          const near = below || [[1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].some(([dx, dy]) => {
            const nx = tx + dx, ny = ty + dy;
            return nx >= 0 && ny >= 0 && nx < map.cols && ny < map.rows && !map.tiles[ny * map.cols + nx];
          });
          if (!near) continue;
          ctx.fillStyle = '#2b2440';
          ctx.fillRect(px, py, TILE, TILE);
          if (below) {
            ctx.fillStyle = '#3d3460';
            ctx.fillRect(px, py + TILE - 8, TILE, 8);
          }
        } else {
          const inCamp = camp && Math.hypot(tx * TILE + 16 - camp.x, ty * TILE + 16 - camp.y) <= camp.r;
          ctx.fillStyle = inCamp
            ? ((tx + ty) % 2 ? '#262035' : '#2a2339')
            : ((tx + ty) % 2 ? '#1b1a2e' : '#1f1e34');
          ctx.fillRect(px, py, TILE, TILE);
        }
      }
    }
    if (camp) {
      ctx.strokeStyle = 'rgba(255, 183, 77, .35)';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(camp.x - cam.x, camp.y - cam.y, camp.r + TILE / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 잠긴 문
    const room = snap && snap.ar >= 0 ? map.rooms[snap.ar] : null;
    if (room) {
      for (const [dx, dy] of room.doors) {
        const px = dx * TILE - cam.x, py = dy * TILE - cam.y;
        ctx.fillStyle = '#6d4c41';
        ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#ef9a9a';
        ctx.fillRect(px + 12, py + 12, 8, 8);
      }
    }
  }

  function drawCampfire(x, y, now) {
    const flick = Math.sin(now / 90) * 2;
    circle(x, y + 6, 12, '#5d4037');
    circle(x, y, 9 + flick * 0.5, '#ff7043');
    circle(x, y - 3, 5 + flick * 0.3, '#ffd54f');
  }

  const PORTAL_COLORS = { adv: ['#7e57c2', '#b39ddb', '#ede7f6'], camp: ['#e65100', '#ffb74d', '#fff3e0'] };
  function drawPortal(x, y, now, progress, kind = 'adv', closed = false) {
    ctx.save();
    ctx.translate(x, y);
    if (closed) {
      // 보스를 잡기 전에는 닫혀 있는 포털 (바닥 문양만)
      ctx.strokeStyle = 'rgba(179,157,219,.35)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 10, 30, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = PORTAL_COLORS[kind][i];
      ctx.lineWidth = 4 - i;
      ctx.beginPath();
      ctx.ellipse(0, 0, 26 - i * 6, 40 - i * 9, Math.sin(now / 500 + i) * 0.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (progress > 0) {
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 52, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
      ctx.stroke();
    }
    ctx.restore();
  }

  // 울타리(나무 말뚝)·터렛(돌탑 + 회전 쇠뇌): assets/fence.png, turret.png를 2배로
  function drawStruct(s, cam) {
    const x = s.tx * TILE - cam.x, y = s.ty * TILE - cam.y, cx = x + TILE / 2, cy = y + TILE / 2;
    if (s.k === 'fence') {
      if (sprites.ready) ctx.drawImage(sprites.fence, x, y, 32, 32);
    } else {
      if (sprites.ready) ctx.drawImage(sprites.turret, x, y + 32 - 52, 32, 52);
      ctx.save();
      ctx.translate(cx, y - 8);
      ctx.rotate(s.a);
      ctx.fillStyle = '#1a1622'; ctx.fillRect(-2, -6, 6, 12); ctx.fillRect(0, -2, 16, 4);
      ctx.fillStyle = '#8d6e63'; ctx.fillRect(-1, -5, 4, 10);
      ctx.fillStyle = '#cfd8dc'; ctx.fillRect(1, -1, 14, 2);
      ctx.restore();
    }
    if (s.hp < s.mh) hpBar(cx, y - (s.k === 'fence' ? 2 : 26), 26, s.hp, s.mh);
  }

  // ---------- 캐릭터 ----------
  function drawStatus(e, now) {
    const s = e.s || '';
    if (!s) return;
    if (s.includes('f')) {
      ctx.fillStyle = 'rgba(178,235,242,.55)';
      ctx.strokeStyle = '#e0f7fa';
      ctx.lineWidth = 2;
      ctx.fillRect(e.x - e.r - 3, e.y - e.r - 3, e.r * 2 + 6, e.r * 2 + 6);
      ctx.strokeRect(e.x - e.r - 3, e.y - e.r - 3, e.r * 2 + 6, e.r * 2 + 6);
    } else if (s.includes('c')) {
      ctx.strokeStyle = 'rgba(178,235,242,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.includes('b')) {
      for (let i = 0; i < 3; i++) {
        circle(e.x + (i - 1) * e.r * 0.6, e.y - e.r * 0.6 - ((now / 4 + i * 60) % 12), 3, i % 2 ? '#ffca28' : '#ff7043');
      }
    }
    if (s.includes('w')) {
      circle(e.x - e.r * 0.8, e.y + 3 + Math.sin(now / 150) * 2, 2.5, '#42a5f5');
      circle(e.x + e.r * 0.8, e.y + 5 + Math.cos(now / 150) * 2, 2.5, '#42a5f5');
    }
    if (s.includes('p')) {
      ctx.fillStyle = 'rgba(156,204,101,.35)';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 2, 0, Math.PI * 2);
      ctx.fill();
      circle(e.x + e.r * 0.5, e.y - e.r - ((now / 6) % 10), 2.5, '#9ccc65');
    }
    if (s.includes('z')) {
      ctx.strokeStyle = '#fff176';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = now / 120 + (i * Math.PI) / 2;
        ctx.moveTo(e.x + Math.cos(a) * (e.r + 2), e.y + Math.sin(a) * (e.r + 2));
        ctx.lineTo(e.x + Math.cos(a) * (e.r + 7), e.y + Math.sin(a) * (e.r + 7));
      }
      ctx.stroke();
    }
  }

  // 몬스터 도트: enemies.png 24x24 (종류마다 [1, 2, 쓰러짐], 마지막 = 영혼), bosses.png 40x40 (월드마다 [1, 2, 쓰러짐])
  const ENEMY_ORDER = ['slime', 'archer', 'brute', 'bat', 'spider', 'bomber', 'caster', 'shield', 'totem'];
  const ENEMY_FRAME = Object.fromEntries(ENEMY_ORDER.map((k, i) => [k, i * 3]));
  ENEMY_FRAME.bigslime = ENEMY_FRAME.slime;
  ENEMY_FRAME.elite = ENEMY_FRAME.brute;
  const SOUL_FRAME = ENEMY_ORDER.length * 3;
  const BASE_R = { bigslime: 13, elite: 17 };   // 큰 슬라임·정예는 그림을 크게
  const BOSS_FRAME = { '#66bb6a': 0, '#9575cd': 3, '#e57373': 6 };

  function drawSprite(sheet, hitSheet, frame, size, scale, x, y, flip, hit) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (flip) ctx.scale(-1, 1);
    const d = size * scale;
    ctx.drawImage(hit ? hitSheet : sheet, frame * size, 0, size, size, -d / 2, -d + 6 * scale, d, d);
    ctx.restore();
  }

  function drawBoss(e, now, viewer) {
    const pulse = Math.sin(now / 160) * 2;
    circle(e.x, e.y + e.r * 0.75, e.r, 'rgba(0,0,0,.35)');
    const lift = e.ai ? 60 : 0; // 점프 중엔 공중에
    if (e.ch) {
      ctx.strokeStyle = '#ff5252';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 8 + pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (sprites.ready) {
      const frame = (BOSS_FRAME[e.c] ?? 0) + (Math.floor(now / 350) % 2);
      drawSprite(sprites.bosses, sprites.bossesHit, frame, 40, 2, e.x, e.y + e.r - lift, viewer && viewer.x < e.x, e.h);
    } else {
      circle(e.x, e.y, e.r, e.c || '#e57373');
    }
    drawStatus(e, now);
  }

  function drawEnemy(e, now, viewer) {
    if (e.k === 'boss') { drawBoss(e, now, viewer); return; }
    circle(e.x, e.y + e.r * 0.7, e.r * 0.9, 'rgba(0,0,0,.25)');
    if (e.fu && Math.floor(now / 90) % 2) circle(e.x, e.y, e.r + 6, 'rgba(255,82,82,.5)'); // 폭탄 고블린 점화
    if (sprites.ready && ENEMY_FRAME[e.k] !== undefined) {
      const frame = ENEMY_FRAME[e.k] + (Math.floor(now / (e.k === 'bat' ? 120 : 300) + e.id * 0.37) % 2);
      const scale = 2 * (BASE_R[e.k] ? e.r / BASE_R[e.k] : 1);
      // 방패병·토템은 바라보는 방향, 나머지는 플레이어 쪽
      const flip = e.k === 'shield' ? Math.cos(e.f) < 0 : viewer && viewer.x < e.x;
      drawSprite(sprites.enemies, sprites.enemiesHit, frame, 24, scale, e.x, e.y + e.r * (scale / 2), flip, e.h);
    } else {
      circle(e.x, e.y, e.r, e.h ? '#fff' : ENEMY_COLORS[e.k] || '#ccc');
    }
    drawStatus(e, now);
    if (e.hp < e.mh) hpBar(e.x, e.y - e.r - 14, e.r * 2, e.hp, e.mh);
  }

  // ---------- 도트 스프라이트 ----------
  // assets/player.png: 32x32 x 13 (0~3 대기, 4~11 걷기, 12 쓰러짐)
  // assets/weapons.png: 24x12 x 17 (순서는 tools/make_sprites.py의 WEAPON_ORDER)
  function drawWeaponSprite(key, x, y, scale, angle = 0, flip = false, alpha = 1) {
    const i = WEAPON_SPRITES.indexOf(key);
    if (i < 0 || !sprites.ready) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    if (flip) ctx.scale(1, -1);
    ctx.drawImage(sprites.weapons, i * 24, 0, 24, 12, -GRIP_X * scale, -GRIP_Y * scale, 24 * scale, 12 * scale);
    ctx.restore();
  }

  function heldKey(p) {
    return p.ws?.[p.sl]?.k || p.wp;
  }

  function drawPlayer(p, isMe, now) {
    const facingLeft = Math.cos(p.a) < 0;
    const key = heldKey(p);
    // 무기가 위쪽을 향하면 몸 뒤에, 아래쪽이면 몸 앞에 그립니다.
    const weaponBehind = Math.sin(p.a) < -0.2;
    let handX = p.x, handY = p.y + 4, wa = p.a;
    // 근접 무기 휘두르기: 검·해머는 호를 그리며 회전, 창은 앞으로 찌름
    const W = WEAPONS[key];
    if (p.sgt > 0 && W && W.kind !== 'ranged') {
      const prog = 1 - p.sgt; // 0 → 1
      if (W.fam === 'spear') {
        const thrust = Math.sin(Math.PI * prog) * 16;
        handX += Math.cos(p.a) * thrust;
        handY += Math.sin(p.a) * thrust;
      } else {
        const arc = W.fam === 'hammer' ? 1.6 : Math.min(2.2, (W.arc || 1.6));
        wa = p.a + p.sgd * (arc / 2) * (2 * prog - 1);
      }
    }

    // 활 차징: 활을 몸 쪽으로 당김
    const cg = p.al ? Math.min(1, p.cg || 0) : 0;
    if (cg > 0) { handX -= Math.cos(p.a) * 4 * cg; handY -= Math.sin(p.a) * 4 * cg; }

    ctx.save();
    if (!p.al) ctx.globalAlpha = 0.5;
    else if (p.iv && Math.floor(now / 80) % 2) ctx.globalAlpha = 0.55;

    if (p.al && p.el && ELEMENTS[p.el]) {
      ctx.strokeStyle = ELEMENTS[p.el].color;
      ctx.globalAlpha *= 0.7;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 12, 18 + Math.sin(now / 200) * 1.5, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha /= 0.7;
    }
    if (p.al && weaponBehind) drawWeaponSprite(key, handX, handY, PIXEL, wa, facingLeft);

    const sheet = sprites.ready ? tintedPlayer(p.c, p.sk, designOf(p.cr, p.sk)) : null;
    if (sheet) {
      let frame;
      if (!p.al) frame = 12;
      else if (p.mv) frame = 4 + (Math.floor(now / 75) % 8);
      else frame = Math.floor(now / 220) % 4;
      // 대시 잔상: 대시하기 전 자리에서 지금 자리까지 옅게
      if (p.ds && p.al && (p.dx || p.dy)) {
        for (let i = 0; i < 3; i++) {
          const t = i / 3;
          ctx.globalAlpha *= 0.3 - i * 0.07;
          drawPlayerFrame(sheet, frame, lerp(p.dx, p.x, t), lerp(p.dy, p.y, t), facingLeft, false);
          ctx.globalAlpha /= 0.3 - i * 0.07;
        }
      }
      drawPlayerFrame(sheet, frame, p.x, p.y, facingLeft, false);
    } else {
      circle(p.x, p.y, 12, p.c);
    }
    if (p.al && !weaponBehind) drawWeaponSprite(key, handX, handY, PIXEL, wa, facingLeft);
    ctx.restore();

    // 차징 게이지: 발밑 둘레 원호 + (내 캐릭터는) 조준선. 다 모으면 하얗게 반짝
    if (cg > 0) {
      const full = (p.cg || 0) >= 1;
      ctx.save();
      if (isMe) {
        ctx.strokeStyle = full ? 'rgba(255,255,255,.75)' : `rgba(255,213,79,${0.25 + cg * 0.4})`;
        ctx.lineWidth = full ? 2 : 1.5;
        ctx.setLineDash([6, 6]);
        const L = 40 + 110 * cg;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(p.a) * 20, p.y + Math.sin(p.a) * 20);
        ctx.lineTo(p.x + Math.cos(p.a) * L, p.y + Math.sin(p.a) * L);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = 'rgba(0,0,0,.6)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = full ? (Math.floor(now / 90) % 2 ? '#ffffff' : '#fff59d') : '#ffd54f';
      ctx.lineWidth = full ? 4 : 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cg); ctx.stroke();
      ctx.restore();
    }

    // 기사 방패 준비 표시
    if (p.al && p.sh) {
      ctx.strokeStyle = 'rgba(144,202,249,.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y - 2, 20, -2.4, -0.7);
      ctx.stroke();
    }

    ctx.fillStyle = isMe ? '#fff' : p.c;
    ctx.font = isMe ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'center';
    const tag = p.al ? `${p.pz ? '⏸ ' : ''}${p.n}${p.rd ? ' ✔' : ''}` : `${p.n} (쓰러짐)`;
    ctx.fillText(tag, p.x, p.y - 30);
    if (p.gd) {
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = p.gd[1];
      ctx.fillText(`[${p.gd[0]}]`, p.x, p.y - 43);
    }
  }

  function drawPlayerFrame(sheet, frame, x, y, flip, trail) {
    // 스프라이트의 (16, 25) = 발밑을 캐릭터 위치 아래 12px에 맞춤
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + 12));
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(sheet, frame * 32, 0, 32, 32, -16 * PIXEL, -25 * PIXEL, 32 * PIXEL, 32 * PIXEL);
    ctx.restore();
  }

  function drawBullet(b) {
    const color = b.o ? '#ff5252' : ELEMENTS[b.el]?.color ?? '#ffffff';
    if (b.k === 'meteor') {
      // 떨어질 자리 그림자 + 불타는 운석
      ctx.save();
      ctx.globalAlpha = 0.35;
      circle(b.tx, b.ty, b.rr, '#bf360c');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff7043';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.tx, b.ty, b.rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      circle(b.x + 10, b.y - 14, 10, 'rgba(255,171,64,.5)');
      circle(b.x, b.y, 15, '#fff');
      circle(b.x, b.y, 13, '#6d4c41');
      circle(b.x - 3, b.y - 3, 6, '#ff7043');
      return;
    }
    if (b.k === 'fireball') {
      circle(b.x - Math.cos(b.a) * 8, b.y - Math.sin(b.a) * 8, 7, 'rgba(255,112,67,.5)');
      circle(b.x, b.y, 10, '#fff');
      circle(b.x, b.y, 8, '#ff7043');
      circle(b.x + 1, b.y - 1, 4, '#ffd54f');
      return;
    }
    if (b.k === 'icespike' || b.k === 'icelance') {
      const L = b.k === 'icelance' ? 26 : 16;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(L / 2 + 3, 0); ctx.lineTo(-L / 2 - 2, -6); ctx.lineTo(-L / 2 - 2, 6);
      ctx.fill();
      ctx.fillStyle = '#b2ebf2';
      ctx.beginPath();
      ctx.moveTo(L / 2, 0); ctx.lineTo(-L / 2, -4); ctx.lineTo(-L / 2, 4);
      ctx.fill();
      ctx.restore();
      return;
    }
    if (b.k === 'boomerang') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(performance.now() / 50);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(0, 3); ctx.lineTo(9, -6); ctx.stroke();
      ctx.strokeStyle = '#ffb74d'; ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (b.k === 'drone') { circle(b.x, b.y, 3.5, '#fff'); circle(b.x, b.y, 2.5, '#00e5ff'); return; }
    if (b.k === 'javelin') {
      drawWeaponSprite('spear', b.x, b.y, 1.5, b.st ? b.a : b.a, false, 1);
      return;
    }
    if (b.k && WEAPONS[b.k]?.fam === 'bow') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-13, -2.5, 18, 5);
      ctx.fillStyle = color === '#ffffff' ? '#a1887f' : color;
      ctx.fillRect(-12, -1.5, 16, 3);
      ctx.fillStyle = '#e0e0e0';
      ctx.beginPath();
      ctx.moveTo(4, -4); ctx.lineTo(10, 0); ctx.lineTo(4, 4);
      ctx.fill();
      ctx.restore();
    } else if (b.k === 'wave') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.strokeStyle = color === '#ffffff' ? '#e0f7fa' : color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(-4, 0, 9, -1.1, 1.1);
      ctx.stroke();
      ctx.restore();
    } else if (b.k === 'grenade') {
      circle(b.x, b.y, 6, '#fff');
      circle(b.x, b.y, 4.5, '#37474f');
      circle(b.x + 1.5, b.y - 1.5, 1.5, color === '#ffffff' ? '#ffd54f' : color);
    } else {
      circle(b.x, b.y, b.r + 1, b.o ? '#7f0000' : '#ffffff');
      circle(b.x, b.y, b.r, color === '#ffffff' && !b.o ? '#fff59d' : color);
    }
  }

  function drawChest(c) {
    if (!sprites.ready) return;
    const i = WEAPON_SPRITES.indexOf(c.o ? 'chest_open' : 'chest');
    const k = c.b ? 3 : 2; // 상자방의 큰 상자
    ctx.drawImage(sprites.weapons, i * 24, 0, 24, 12, c.x - 12 * k, c.y - 6 * k, 24 * k, 12 * k);
  }

  // 무기 능력치 말풍선 (줍기 전·상점)
  function weaponTip(k, el, lv, x, y, head, me) {
    const W = WEAPONS[k];
    if (!W) return;
    const i = weaponInfo(k);
    const E = ELEMENTS[el];
    const lines = [
      `${TIER_NAME[W.tier]} · ${W.kind === 'ranged' ? '원거리' : '근접'}${W.evo ? ' · 진화 가능' : ''}`,
      `피해 ${i.dmg}${i.shots > 1 ? ` x${i.shots}` : ''} · ${i.charge ? `차징 ${i.charge}초 (최대 x1.6)` : `초당 ${i.aps}회`} · 치명 ${i.crit}% (x${i.critX})`,
      `${W.kind === 'ranged' ? `명중 ${i.acc}% · ` : ''}사거리 ${i.range}${i.pierce ? ` · 관통 ${i.pierce}` : ''}${i.blast ? ' · 폭발' : ''}${i.falloff ? ' · 가까울수록 강함' : ''}`,
      `마나 ${i.mana ? `${i.mana}/발` : '없음'}${E ? ` · ${E.name} 속성 Lv${lv || 1}` : ''}`,
    ];
    if (E && me?.el) lines.push(E === ELEMENTS[me.el] ? '내 캐릭터 속성과 같음 → 공명 (피해 x1.2)' : `내 캐릭터 속성과 결합 → ${reactionName(el, me.el)}`);
    const w = 270, h = 30 + lines.length * 15;
    const bx = Math.round(x - w / 2), by = Math.round(y - h - 10);
    ctx.fillStyle = 'rgba(14,12,26,.92)';
    roundRect(bx, by, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = E ? E.color : 'rgba(255,255,255,.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = elColor(el);
    ctx.fillText(`${head} ${weaponLabel(k, el)}`, bx + 10, by + 18);
    ctx.font = '11.5px sans-serif';
    ctx.fillStyle = '#d7d1f0';
    lines.forEach((t, n) => ctx.fillText(t, bx + 10, by + 36 + n * 15));
  }

  function drawPickup(o, now, near) {
    const bob = Math.sin(now / 300 + o.id) * 2;
    const glow = ELEMENTS[o.el]?.color || '#ffffff';
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + 8, 22, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    drawWeaponSprite(o.k, o.x - 13, o.y + bob, PIXEL * 0.75, 0, false);
    if (!near) {
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = elColor(o.el);
      ctx.fillText(WEAPONS[o.k]?.name ?? '', o.x, o.y - 12);
    }
  }

  // 상점 상품 (진열대 + 가격)
  const SHOP_ICON = { heal: ['♥', '#ef5350'], mana: ['✦', '#42a5f5'], card: ['★', '#ffd54f'] };
  function drawShopItem(o, now, me) {
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(o.x - 22, o.y + 8, 44, 10);
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(o.x - 22, o.y + 6, 44, 3);
    if (o.so) { label('판매 완료', o.x, o.y, '#757575', 10); return; }
    const bob = Math.sin(now / 300 + o.id) * 2;
    if (o.kd === 'weapon') drawWeaponSprite(o.k, o.x - 13, o.y - 4 + bob, PIXEL * 0.75, 0, false);
    else {
      const [ic, c] = SHOP_ICON[o.kd];
      label(ic, o.x, o.y + 2 + bob, c, 20);
    }
    const afford = (me?.co ?? 0) >= o.pr;
    label(`● ${o.pr}`, o.x, o.y + 32, afford ? '#ffd54f' : '#ef9a9a', 11);
  }

  function drawZone(z, now) {
    const color = ELEMENTS[z.el]?.color || '#ffffff';
    if (z.k === 'fire') { drawFireZone(z, now); return; }
    if (z.k && z.k !== 'rain') { drawSkillZone(z, now, color); return; }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 떨어지는 화살 (보기용)
    for (let i = 0; i < 10; i++) {
      const a = i * 2.39996, rr = z.r * Math.sqrt(((i * 37) % 10) / 10);
      const ax = z.x + Math.cos(a) * rr, ay = z.y + Math.sin(a) * rr;
      const fall = ((now / 4 + i * 47) % 60);
      ctx.fillRect(ax - 1, ay - 60 + fall, 2, 12);
    }
    ctx.restore();
  }

  function drawSkillZone(z, now, color) {
    ctx.save();
    const t = now / 1000;
    if (z.k === 'whirl' || z.k === 'tornado') {
      ctx.globalAlpha = 0.18;
      circle(z.x, z.y, z.r, color);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const rr = z.r * (0.35 + i * 0.25);
        const a0 = t * (z.k === 'tornado' ? 9 : 5) + i * 2;
        ctx.arc(z.x, z.y - (z.k === 'tornado' ? i * 8 : 0), rr, a0, a0 + 2.4);
        ctx.stroke();
      }
    } else if (z.k === 'storm') {
      ctx.globalAlpha = 0.1;
      circle(z.x, z.y, z.r, color);
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = color;
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, t * 2, t * 2 + Math.PI * 2);
      ctx.stroke();
    } else if (z.k === 'cloud') {
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + t * 0.6, rr = z.r * (0.25 + ((i * 37) % 10) / 16);
        ctx.globalAlpha = 0.28;
        circle(z.x + Math.cos(a) * rr * 0.7, z.y + Math.sin(a) * rr * 0.5, z.r * 0.42, color);
      }
    }
    ctx.restore();
  }

  function drawOrb(o, now) {
    const bob = Math.sin(now / 200 + o.id) * 2;
    if (o.k === 'h') { circle(o.x, o.y + bob, 6, '#fff'); circle(o.x, o.y + bob, 5, '#d84315'); circle(o.x + 3, o.y + 3 + bob, 2.5, '#fff3e0'); return; }
    if (o.k === 'm') { circle(o.x, o.y + bob, 5, '#fff'); circle(o.x, o.y + bob, 4, '#2196f3'); circle(o.x - 1, o.y - 1 + bob, 1.5, '#bbdefb'); return; }
    if (o.k === 'g') { circle(o.x, o.y + bob, 5, '#8d6e00'); circle(o.x, o.y + bob, 4, '#ffd54f'); ctx.fillStyle = '#ffecb3'; ctx.fillRect(o.x - 1, o.y - 2 + bob, 1.5, 4); return; }
    ctx.fillStyle = '#69f0ae';
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - 5 + bob);
    ctx.lineTo(o.x + 4, o.y + bob);
    ctx.lineTo(o.x, o.y + 5 + bob);
    ctx.lineTo(o.x - 4, o.y + bob);
    ctx.fill();
  }

  function drawFx(list) {
    for (const f of list || []) {
      const k = f.t / f.life;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k * 1.5));
      if (f.k === 'l') {
        ctx.strokeStyle = f.c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        for (let i = 1; i < 5; i++) {
          const t = i / 5;
          ctx.lineTo(lerp(f.x, f.x2, t) + (Math.random() - 0.5) * 10, lerp(f.y, f.y2, t) + (Math.random() - 0.5) * 10);
        }
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
      } else if (f.k === 'r') {
        ctx.strokeStyle = f.c;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (1 - k * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      } else if (f.k === 'a') {
        // 근접 공격 궤적
        ctx.fillStyle = f.c;
        ctx.globalAlpha *= 0.35;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, f.r, f.a - f.s / 2, f.a + f.s / 2);
        ctx.closePath();
        ctx.fill();
      } else if (f.k === 'sw') {
        // 검: 초승달 모양 베기 궤적 (k: 1 → 0)
        const prog = 1 - k;
        const a0 = f.a - f.d * f.s / 2;
        const sweep = f.s * Math.min(1, prog * 1.6);
        const a1 = a0 + f.d * sweep;
        const from = Math.min(a0, a1), to = Math.max(a0, a1);
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = f.c === '#ffffff' ? 'rgba(255,255,255,.55)' : f.c;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, from, to);
        ctx.arc(f.x, f.y, f.r * 0.62, to, from, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, from, to);
        ctx.stroke();
      } else if (f.k === 'th') {
        // 창: 찌르기 섬광 + 속도선
        const prog = 1 - k;
        const len = f.r * Math.min(1, prog * 2.2);
        const ux = Math.cos(f.a), uy = Math.sin(f.a), nx = -uy, ny = ux;
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.strokeStyle = f.c === '#ffffff' ? '#fff9c4' : f.c;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(f.x + ux * 18, f.y + uy * 18);
        ctx.lineTo(f.x + ux * len, f.y + uy * len);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        for (const side of [-1, 1]) {
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(f.x + ux * len * 0.4 + nx * side * 9, f.y + uy * len * 0.4 + ny * side * 9);
          ctx.lineTo(f.x + ux * len * 0.85 + nx * side * 9, f.y + uy * len * 0.85 + ny * side * 9);
          ctx.stroke();
        }
        circle(f.x + ux * len, f.y + uy * len, 5 * k + 2, '#fff');
      } else if (f.k === 'cone') {
        ctx.fillStyle = f.c;
        ctx.globalAlpha *= 0.35;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, f.r * (1.2 - k * 0.5), f.a - f.s / 2, f.a + f.s / 2);
        ctx.closePath();
        ctx.fill();
      } else if (f.k === 'die') {
        drawDeath(f, k);
      } else if (f.k === 'dn') {
        if (!showDamage) { ctx.restore(); continue; }
        if (f.g === 'block') {
          ctx.font = 'bold 14px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#cfd8dc';
          ctx.fillText(f.v, f.x, f.y - (1 - k) * 18);
          ctx.restore();
          continue;
        }
        const crit = f.g === 'crit', dot = f.g === 'dot';
        const y = f.y - (1 - k) * 24;
        ctx.font = `bold ${crit ? 21 : dot ? 13 : 16}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.8)';
        const txt = (f.v >= 10 ? Math.round(f.v) : f.v).toString() + (crit ? '!' : '');
        ctx.strokeText(txt, f.x, y);
        ctx.fillStyle = crit ? '#ffd54f' : dot ? '#bdbdbd' : '#ffffff';
        ctx.fillText(txt, f.x, y);
      } else if (f.k === 't') {
        ctx.fillStyle = f.c;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.lineWidth = 3;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        const y = f.y - (1 - k) * 18;
        ctx.strokeText(f.text, f.x, y);
        ctx.fillText(f.text, f.x, y);
      }
      ctx.restore();
    }
  }

  // ---------- 성 지키기: 성과 군단 ----------
  // 성: assets/castle.png (64x70)를 2배로. 맞으면 잠깐 빨갛게
  function drawCastle(ca, now) {
    const x = ca.x, y = ca.y;
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(x, y + 36, 70, 18, 0, 0, Math.PI * 2); ctx.fill();
    if (sprites.ready) {
      ctx.drawImage(sprites.castle, Math.round(x - 64), Math.round(y + 44 - 140), 128, 140);
      if (ca.h) {
        ctx.fillStyle = 'rgba(255,82,82,.22)';
        ctx.beginPath(); ctx.ellipse(x, y - 20, 62, 62, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const w = 96;
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(x - w / 2, y - 112, w, 7);
    ctx.fillStyle = ca.hp < ca.mh * 0.3 ? '#ff5252' : '#66bb6a'; ctx.fillRect(x - w / 2, y - 112, (w * ca.hp) / ca.mh, 7);
    label(`성 Lv${ca.lv}`, x, y - 118, '#ffe082', 11);
    // 거치한 무기 (모험에서 가져온 무기)
    const MP = [[-30, -52], [30, -52], [-44, -10], [44, -10]];
    (ca.mt || []).forEach(([k, a, el], i) => {
      const [ox, oy] = MP[i] || [0, 0];
      if (el && ELEMENTS[el]) circle(x + ox, y + oy, 9, ELEMENTS[el].color + '55');
      drawWeaponSprite(k, x + ox, y + oy, 2, a, Math.cos(a) < 0);
    });
  }

  const UNIT_ORDER = Object.keys(UNITS);
  function drawUnit(u, snap, now) {
    const [id, kind, x, y, hp, oi, face, atk, hit] = u;
    const U = UNITS[kind];
    if (!U) return;
    const owner = snap.p[oi];
    const color = owner?.c || '#ffffff';
    const big = kind === 'giant';
    const sc = big ? 2.2 : 1.3;
    circle(x, y + U.r * 0.8, U.r, 'rgba(0,0,0,.25)');
    if (sprites.ready) {
      const sheet = tintedPlayer(color, { body: U.body, eye: U.eye }, U.design);
      const frame = 4 + (Math.floor(now / 90 + id) % 8);
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y + U.r));
      if (face < 0) ctx.scale(-1, 1);
      if (hit) ctx.globalAlpha = 0.6;
      ctx.drawImage(sheet, frame * 32, 0, 32, 32, -16 * sc, -25 * sc, 32 * sc, 32 * sc);
      ctx.restore();
      const wa = atk ? (face < 0 ? Math.PI + 0.8 : -0.8) : (face < 0 ? Math.PI - 0.3 : 0.3);
      drawWeaponSprite(U.weapon, x + face * 4, y + 2, big ? 2 : 1.2, wa, face < 0);
    } else circle(x, y, U.r, color);
    if (hp < 100) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - 10, y - U.r * 2 - 10, 20, 3);
      ctx.fillStyle = '#81c784'; ctx.fillRect(x - 10, y - U.r * 2 - 10, (20 * hp) / 100, 3);
    }
  }

  // 화면 위 가운데: 골드 · 성 체력 · 군단 · 킬 (영상 속 디펜스 게임처럼)
  function drawCastleBar(snap, me) {
    const ca = snap.ca;
    const w = 440, x = (VIEW_W - w) / 2, y = 8;
    ctx.fillStyle = 'rgba(40,30,28,.88)';
    roundRect(x, y, w, 46, 8);
    ctx.fill();
    ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 3; ctx.stroke();
    const cols = [
      ['골드', `${snap.g}`, '#ffd54f'],
      ['성 체력', `${ca.hp}/${ca.mh}`, ca.hp < ca.mh * 0.3 ? '#ff5252' : '#ef9a9a'],
      ['군단', `${me ? me.uc : 0}/${me ? me.ucap : 0}`, '#90caf9'],
      ['라운드', `${snap.sv?.r ?? 1}`, '#fff'],
    ];
    cols.forEach(([t, v, c], i) => {
      const cx = x + w / 8 + (i * w) / 4;
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#d7ccc8'; ctx.fillText(t, cx, y + 18);
      ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = c; ctx.fillText(v, cx, y + 38);
    });
  }

  // 화면 아래 가운데: 군단 소환 (4~7 키) + 성 강화 (T)
  function drawSummonBar(snap, me) {
    const list = me?.ar || [];
    const bw = 74, bh = 54, gap = 8, n = list.length + 1;
    const x0 = 282, y0 = VIEW_H - bh - 26;
    const box = (i, title, sub, key, ok, color) => {
      const x = x0 + i * (bw + gap);
      ctx.fillStyle = ok ? 'rgba(62,39,35,.92)' : 'rgba(30,25,25,.85)';
      roundRect(x, y0, bw, bh, 8);
      ctx.fill();
      ctx.strokeStyle = ok ? color : 'rgba(255,255,255,.2)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = ok ? '#fff' : '#9e9e9e'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(title, x + bw / 2, y0 + 30);
      ctx.fillStyle = ok ? '#ffd54f' : '#8d6e63'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(sub, x + bw / 2, y0 + 46);
      ctx.fillStyle = '#fff'; roundRect(x + bw - 18, y0 - 8, 22, 18, 5); ctx.fill();
      ctx.fillStyle = '#3e2723'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(key, x + bw - 7, y0 + 5);
    };
    list.forEach(([k, cost, lv], i) => {
      const U = UNITS[k];
      box(i, `${U.name} Lv${lv}`, `● ${cost}`, String(4 + i), snap.g >= cost && me.uc < me.ucap, U.body);
      if (sprites.ready) {
        const x = x0 + i * (bw + gap);
        ctx.drawImage(tintedPlayer(me.c, { body: U.body, eye: U.eye }, U.design), 0, 0, 32, 32, x + 4, y0 + 2, 22, 22);
      }
    });
    box(list.length, '성 강화', `Lv${snap.ca.lv}`, 'T', true, '#ffd54f');
  }

  // ---------- 함정 ----------
  // 가시·분사구는 snap.tm(게임 시간)으로 박자를 맞춰 그립니다.
  function drawTraps(map, snap, now) {
    const traps = map.traps || [];
    if (!traps.length) return;
    const alive = new Set(snap.br || []);
    const t = snap.tm ?? now / 1000;
    for (const tr of traps) {
      const x = tr.x, y = tr.y;
      if (tr.k === 'barrel') {
        if (!alive.has(tr.id)) {
          ctx.fillStyle = 'rgba(30,20,20,.5)';
          ctx.beginPath(); ctx.ellipse(x, y + 6, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
          continue;
        }
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 11, y - 15, 22, 28);
        ctx.fillStyle = '#c62828'; ctx.fillRect(x - 10, y - 14, 20, 26);
        ctx.fillStyle = '#8e0000'; ctx.fillRect(x - 10, y - 8, 20, 3); ctx.fillRect(x - 10, y + 4, 20, 3);
        ctx.fillStyle = '#ffd54f'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', x, y + 2);
        continue;
      }
      if (tr.k === 'poison') {
        ctx.save();
        ctx.globalAlpha = 0.45 + Math.sin(now / 300 + tr.id) * 0.08;
        ctx.fillStyle = '#558b2f';
        ctx.beginPath(); ctx.ellipse(x, y, TRAPS.poison.r, TRAPS.poison.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.8;
        for (let i = 0; i < 3; i++) circle(x + Math.cos(i * 2.1 + tr.id) * 18, y + Math.sin(i * 2.1 + tr.id) * 12 - ((now / 20 + i * 30) % 14), 3, '#9ccc65');
        ctx.restore();
        continue;
      }
      const D = TRAPS[tr.k];
      const ph = (t + tr.off) % D.cycle;
      const warn = ph >= D.warn && ph < D.on, on = ph >= D.on;
      if (tr.k === 'spike') {
        ctx.fillStyle = '#2a2438';
        ctx.fillRect(x - 14, y - 14, 28, 28);
        ctx.strokeStyle = warn ? '#ff8a80' : '#3f3656';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 13, y - 13, 26, 26);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const px = x - 9 + i * 9, py = y - 9 + j * 9;
          if (on) {
            ctx.fillStyle = '#eceff1';
            ctx.beginPath(); ctx.moveTo(px - 3, py + 3); ctx.lineTo(px, py - 6); ctx.lineTo(px + 3, py + 3); ctx.fill();
          } else circle(px, py, 1.6, warn && Math.floor(now / 80) % 2 ? '#ff8a80' : '#15121f');
        }
      } else if (tr.k === 'vent') {
        const ux = [1, 0, -1, 0][tr.a], uy = [0, 1, 0, -1][tr.a];
        ctx.fillStyle = '#37474f'; ctx.fillRect(x - 11, y - 11, 22, 22);
        circle(x, y, 7, warn || on ? '#ff7043' : '#263238');
        if (warn) {
          ctx.save(); ctx.globalAlpha = 0.25; ctx.strokeStyle = '#ff5252'; ctx.lineWidth = D.w; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * D.len, y + uy * D.len); ctx.stroke(); ctx.restore();
        }
        if (on) {
          ctx.save();
          for (let i = 0; i < 6; i++) {
            const d = 12 + i * (D.len - 12) / 5 + Math.sin(now / 50 + i) * 3;
            ctx.globalAlpha = 0.85 - i * 0.08;
            circle(x + ux * d, y + uy * d, D.w / 2 - i, i % 2 ? '#ffca28' : '#ff7043');
          }
          ctx.restore();
        }
      }
    }
  }

  function drawFireZone(z, now) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    circle(z.x, z.y, z.r, '#ff5722');
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4 + z.x, rr = z.r * (0.2 + ((i * 37) % 10) / 13);
      const fy = (now / 8 + i * 40) % 22;
      ctx.globalAlpha = 0.75 * (1 - fy / 22);
      circle(z.x + Math.cos(a) * rr * 0.9, z.y + Math.sin(a) * rr * 0.6 - fy, 5 - fy / 6, i % 2 ? '#ffca28' : '#ff7043');
    }
    ctx.restore();
  }

  // 쓰러진 적: 눕은 몸이 바래 가고, 영혼이 위로 빠져나감 (k: 1 → 0)
  function drawDeath(f, k) {
    if (!sprites.ready) return;
    const prog = 1 - k;
    const boss = f.ek === 'boss';
    ctx.globalAlpha = Math.min(1, k * 2.2);
    if (boss) {
      const fr = (BOSS_FRAME[f.c] ?? 0) + 2;
      ctx.drawImage(sprites.bosses, fr * 40, 0, 40, 40, f.x - 40, f.y + f.r - 74, 80, 80);
    } else if (ENEMY_FRAME[f.ek] !== undefined) {
      const sc = 2 * (BASE_R[f.ek] ? f.r / BASE_R[f.ek] : 1);
      const fr = ENEMY_FRAME[f.ek] + 2;
      ctx.drawImage(sprites.enemies, fr * 24, 0, 24, 24, f.x - 12 * sc, f.y + f.r * (sc / 2) - 18 * sc, 24 * sc, 24 * sc);
    }
    // 영혼
    ctx.globalAlpha = Math.max(0, Math.min(1, prog * 3)) * Math.min(1, k * 1.6) * 0.85;
    const sx = f.x + Math.sin(prog * 9) * 5, sy = f.y - 8 - prog * 52;
    const s = boss ? 3 : 1.5;
    ctx.drawImage(sprites.enemies, SOUL_FRAME * 24, 0, 24, 24, sx - 12 * s, sy - 12 * s, 24 * s, 24 * s);
  }

  // 보스 위험 지역: 빨간 경고가 차오르고, 다 차면 터짐 / 레이저
  // 다음 웨이브 몬스터가 나올 자리: 빨간 조준경 (시간이 줄수록 좁아지고, 직전엔 깜빡임)
  function drawSpawnMark(x, y, left, now) {
    const k = Math.max(0, Math.min(1, left / 1.6));
    const r = 11 + 11 * k;
    const blink = left < 0.45 && Math.floor(now / 70) % 2 === 0;
    const col = blink ? '#ffffff' : '#ff5252';
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 90);
    ctx.fillStyle = 'rgba(255,82,82,.16)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate((now / 700) % (Math.PI * 2));
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a);
      ctx.moveTo(c * (r - 6), sn * (r - 6));
      ctx.lineTo(c * (r + 7), sn * (r + 7));
    }
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawHazard(h, now) {
    ctx.save();
    if (h.k === 'circle') {
      const c = h.c || '#ff5252';
      if (!h.on) {
        ctx.globalAlpha = 0.18;
        circle(h.x, h.y, h.r, c);
        ctx.globalAlpha = 0.45;
        circle(h.x, h.y, h.r * h.p, c);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.4 + Math.sin(now / 120) * 0.08;
        circle(h.x, h.y, h.r, c);
      }
    } else {
      const ux = Math.cos(h.a), uy = Math.sin(h.a);
      ctx.lineCap = 'round';
      if (!h.on) {
        ctx.globalAlpha = 0.35 + 0.4 * h.p;
        ctx.strokeStyle = '#ff5252';
        ctx.lineWidth = h.k === 'line' ? h.w : 2 + 3 * h.p;
        if (h.k === 'line') ctx.globalAlpha *= 0.4;
        ctx.setLineDash(h.k === 'line' ? [] : [10, 8]);
      } else {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ff8a80';
        ctx.lineWidth = h.w;
      }
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + ux * h.len, h.y + uy * h.len);
      ctx.stroke();
      if (h.on) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = h.w * 0.35;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---------- HUD ----------
  function banner(text, sub = '') {
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    roundRect(VIEW_W / 2 - 280, 100, 560, sub ? 76 : 52, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(text, VIEW_W / 2, 134);
    if (sub) {
      ctx.font = '15px sans-serif';
      ctx.fillText(sub, VIEW_W / 2, 162);
    }
  }

  const fmtT = (t) => `${t < 0 ? '-' : ''}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, '0')}`;

  function drawCards(me, mouse, camp) {
    cardRects = [];
    if (!me?.of) return;
    const w = 200, h = 84, gap = 14;
    const total = me.of.length * w + (me.of.length - 1) * gap;
    const y = VIEW_H - h - 100;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 14px sans-serif';
    const more = me.oq > 0 ? ` (+${me.oq}장 대기)` : '';
    ctx.fillText(`레벨 업! 증강을 클릭하거나 Z/X/C로 고르세요 · 증강 ${me.at}/${MAX_AUGMENT_TYPES}종${more}`, Math.max(16, (VIEW_W - 190 - total) / 2), y - 8);
    me.of.forEach((key, i) => {
      const x = Math.max(16, (VIEW_W - 190 - total) / 2) + i * (w + gap);
      const hover = mouse.sx >= x && mouse.sx <= x + w && mouse.sy >= y && mouse.sy <= y + h;
      roundRect(x, y, w, h, 10);
      ctx.fillStyle = hover ? 'rgba(75,63,143,.97)' : 'rgba(30,27,52,.94)';
      ctx.fill();
      const cur = me.ws?.[me.sl];
      const info = offerInfo(key, me.bf, cur ? weaponLabel(cur.k, null) : '무기', cur?.el, cur?.lv);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = info.color;
      ctx.fillRect(x + 12, y + 14, 6, 14);
      ctx.fillStyle = '#9e9e9e';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('ZXC'[i], x + w - 22, y + h - 10);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(info.name, x + 26, y + 26);
      const owned = key.startsWith('el:') ? me.ws?.[me.sl]?.el === key.slice(3) : !!me.bf?.[key];
      if (!owned) {
        ctx.fillStyle = '#80cbc4';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('NEW', x + w - 12, y + 24);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = '#b0aacc';
      ctx.font = '12px sans-serif';
      ctx.fillText(info.desc, x + 12, y + 50, w - 24);
      if (info.lv) ctx.fillText(`Lv ${info.lv} / ${info.max}`, x + 12, y + 70);
      cardRects.push({ x, y, w, h });
    });
  }

  function drawMinimap(map, snap, myId) {
    if (!map.rooms.length) return;
    const cell = 22, size = cell * 5, x0 = VIEW_W - size - 14, y0 = 130;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(x0 - 6, y0 - 6, size + 12, size + 12);
    const codes = snap.rs || '';
    // '-' 모름 · 'k' 길만 앎(회색) · 's' 보임 · 'v' 가 봄 · 'c' 클리어 · 'a' 전투 중
    const known = (r) => codes[r.id] && codes[r.id] !== '-';
    const typed = (r) => known(r) && codes[r.id] !== 'k';
    const center = (r) => [x0 + r.gx * cell + cell / 2, y0 + r.gy * cell + cell / 2];
    ctx.lineWidth = 3;
    for (const r of map.rooms) {
      if (!typed(r)) continue;
      for (const id of r.links) {
        const o = map.rooms[id];
        if (!known(o)) continue;
        ctx.strokeStyle = typed(o) ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.15)';
        const [ax, ay] = center(r), [bx, by] = center(o);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
    const ICON = { boss: ['★', '#ffd54f'], shop: ['$', '#ffd54f'], chest: ['▣', '#ffcc80'] };
    for (const r of map.rooms) {
      if (!known(r)) continue;
      const c = codes[r.id];
      ctx.fillStyle = c === 'a' ? '#ef5350' : c === 'c' ? '#66bb6a' : c === 'v' ? '#8d84b5' : c === 's' ? '#9e9e9e' : '#3a3a44';
      ctx.fillRect(x0 + r.gx * cell + 4, y0 + r.gy * cell + 4, cell - 8, cell - 8);
      if (c === 'k') {
        ctx.fillStyle = '#777';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', x0 + r.gx * cell + cell / 2, y0 + r.gy * cell + cell / 2 + 4);
        continue;
      }
      if (ICON[r.type]) {
        ctx.fillStyle = ICON[r.type][1];
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ICON[r.type][0], x0 + r.gx * cell + cell / 2, y0 + r.gy * cell + cell / 2 + 4);
      }
      if (r.type === 'portal') {
        ctx.fillStyle = '#b39ddb';
        ctx.fillRect(x0 + r.gx * cell + 9, y0 + r.gy * cell + 7, cell - 18, cell - 14);
      }
    }
    for (const p of snap.p) {
      const gx = Math.floor(p.x / TILE / CELL), gy = Math.floor(p.y / TILE / CELL);
      const ox = ((p.x / TILE / CELL) % 1) * cell, oy = ((p.y / TILE / CELL) % 1) * cell;
      circle(x0 + gx * cell + ox, y0 + gy * cell + oy, p.id === myId ? 3.5 : 2.5, p.c);
    }
  }

  // 오른쪽 아래: 무기 칸 (스킬 쿨타임, 궁극기 게이지)
  function drawWeaponPanel(me) {
    const slots = me.ws || [];
    const bw = 76, bh = 44, gap = 8;
    const x0 = VIEW_W - 14 - slots.length * (bw + gap) + gap, y0 = VIEW_H - bh - 26;
    const now = performance.now();
    const cur = slots[me.sl];
    if (cur) {
      const fam = weaponFam(cur.k), S = SKILLS[fam];
      const el = ELEMENTS[cur.el];
      ctx.textAlign = 'right';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = elColor(cur.el);
      const mix = el && me.el ? (cur.el === me.el ? ' · 공명!' : ` · 결합(${reactionName(cur.el, me.el)})`) : '';
      ctx.fillText(`${weaponLabel(cur.k, cur.el)}${el ? ` Lv${cur.lv || 1}` : ''} [${TIER_NAME[WEAPONS[cur.k].tier]}]${mix}`, VIEW_W - 14, y0 - 48);
      ctx.font = '11.5px sans-serif';
      ctx.fillStyle = '#cfc8ee';
      ctx.fillText(`우클릭 ${S.skill.name} · Q ${S.ult.name} · 패시브 ${S.passive.name}${slots.length > 1 ? ' · Tab 교체' : ''}`, VIEW_W - 14, y0 - 30);
      const w = me.wst;
      if (w) {
        const W = WEAPONS[cur.k];
        const extra = W.falloff ? ' · 거리 비례 150%→50%' : '';
        ctx.fillStyle = '#ffe0b2';
        ctx.fillText(`피해 ${w.d}${w.ch ? ` (차징 최대 x1.6) · 차징 ${w.ch}초` : ` · 초당 ${w.a}회`} · 명중 ${w.h}% · 치명 ${w.c}% (x${w.x})${w.m ? ` · 마나 ${w.m}` : ''}${extra}`, VIEW_W - 14, y0 - 12);
      }
    }
    slots.forEach((s, i) => {
      const x = x0 + i * (bw + gap), y = y0, active = i === me.sl;
      ctx.fillStyle = 'rgba(15,13,28,.85)';
      roundRect(x, y, bw, bh, 8);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = active ? '#ffd54f' : 'rgba(255,255,255,.25)';
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = active ? 1 : 0.6;
      drawWeaponSprite(s.k, x + 14, y + 22, PIXEL, 0, false);
      ctx.restore();
      if (s.el && ELEMENTS[s.el]) circle(x + bw - 9, y + 9, 5, ELEMENTS[s.el].color);
      ctx.fillStyle = elColor(s.el);
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(WEAPONS[s.k].name, x + 5, y + bh - 4, bw - 10);
      // 스킬: 충전 개수 / 쿨타임
      if (s.c <= 0) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        roundRect(x, y, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(me.cb ? `${Math.ceil(s.cd)}` : `${Math.ceil(s.cd)} ⏸`, x + bw / 2, y + bh / 2 + 5);
      } else if (s.cm > 1) {
        for (let k = 0; k < s.cm; k++) circle(x + 8 + k * 9, y + bh - 8, 3, k < s.c ? '#80deea' : '#455a64');
      }
      // 궁극기 게이지
      const ready = s.u >= 100;
      ctx.fillStyle = '#2a2740';
      ctx.fillRect(x, y + bh + 4, bw, 6);
      ctx.fillStyle = ready ? (Math.floor(now / 250) % 2 ? '#ffd54f' : '#ffecb3') : '#b39ddb';
      ctx.fillRect(x, y + bh + 4, (bw * Math.min(100, s.u)) / 100, 6);
      if (active && ready) {
        ctx.fillStyle = '#ffd54f';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Q 준비!', x + bw / 2, y - 2);
      }
    });
    if (me.sw > 0 && slots.length > 1) {
      ctx.fillStyle = '#9e9e9e';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`교체 대기 ${me.sw.toFixed(1)}초`, VIEW_W - 14, VIEW_H - 8);
    }
  }

  function drawHud(snap, me, map) {
    const adv = snap.md === 'adv';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(10, 10, 240, 92);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(adv ? `스테이지 ${stageLabel(snap.si)}` : `라운드 ${snap.sv?.r ?? 1}${snap.sv?.f ? ` · 남은 적 ${snap.sv.left}` : ' · 준비'}`, 20, 32);
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 15px sans-serif';
    if (!adv) ctx.fillText(`💰 ${snap.g}`, 175, 32);
    else if (me) ctx.fillText(`● ${me.co}`, 185, 32);
    if (me) {
      const hw = Math.min(11, 220 / Math.max(1, me.mh));
      for (let i = 0; i < me.mh; i++) {
        ctx.fillStyle = i < me.hp ? '#ef5350' : '#555';
        ctx.fillRect(20 + i * hw, 39, hw - 3, 10);
      }
      // 마나
      ctx.fillStyle = '#1a2340';
      ctx.fillRect(20, 52, 220, 7);
      ctx.fillStyle = '#42a5f5';
      ctx.fillRect(20, 52, (220 * Math.max(0, me.mp)) / (me.mm || 100), 7);
      ctx.fillStyle = '#bbdefb';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(`${me.mp}`, 22, 59);
      // 레벨 & 경험치 (성 지키기는 레벨업이 없어서 대신 전리품)
      if (adv) {
        ctx.fillStyle = '#69f0ae';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`Lv ${me.lv}`, 20, 72);
        ctx.fillStyle = '#333';
        ctx.fillRect(60, 64, 180, 8);
        ctx.fillStyle = '#69f0ae';
        ctx.fillRect(60, 64, (180 * me.xp) / me.xn, 8);
      } else {
        ctx.fillStyle = '#ffb74d';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`전리품 ✪${me.sp || 0}`, 20, 74);
      }
      ctx.fillStyle = '#ddd';
      ctx.font = '12px sans-serif';
      const el = ELEMENTS[me.el];
      ctx.fillStyle = el ? el.color : '#888';
      const C = CHARACTERS[me.cr];
      ctx.fillText(`${C ? C.name : ''} · ${el ? `${el.name} Lv ${me.elv}` : '속성 없음'}`, 20, 92);
      ctx.fillStyle = '#80deea';
      ctx.fillText(`◆ ${me.es}${me.cw ? `  ♛${me.cw}` : ''}`, 180, 92);
      if (adv) {
      const owned = Object.entries(me.bf || {}).map(([k, n]) => `${BUFFS[k]?.name ?? k} ${n}`);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(10, 106, 240, 16 * owned.length + 26);
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText(`증강 ${me.at}/${MAX_AUGMENT_TYPES}종`, 20, 122);
      ctx.fillStyle = '#c5b8ff';
      owned.forEach((t, i) => ctx.fillText(t, 20, 140 + i * 16));
      }
    }

    ctx.textAlign = 'right';
    ctx.font = '13px sans-serif';
    snap.p.forEach((p, i) => {
      ctx.fillStyle = p.c;
      ctx.fillText(`${p.rd ? '✔ ' : ''}${p.n} · ${CHARACTERS[p.cr]?.name ?? ''} Lv${p.lv}  ${p.hp <= 10 ? '♥'.repeat(Math.max(0, p.hp)) : `♥${p.hp}`}${p.al ? '' : ' ✕'}`, VIEW_W - 14, 52 + i * 18);
    });

    if (me) drawWeaponPanel(me);
    if (me) drawLoadout(me, !adv);
    if (snap.ca) { drawCastleBar(snap, me); drawSummonBar(snap, me); }
    if (snap.bs) drawBossBar(snap.bs, snap.ca ? 78 : 14);
    if (adv) drawMinimap(map, snap, me?.id);
    else {
      ctx.textAlign = 'center';
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#d7ccc8';
      ctx.fillText(`캠프 안: E 울타리(${STRUCTS.fence.cost}) · R 터렛(${STRUCTS.turret.cost}) · F 철거 · 함정으로 적을 유인`, VIEW_W / 2, 68);
    }

    const alive = snap.p.filter((p) => p.al);
    if (snap.ph === 'over') banner(snap.ot, '잠시 후 로비로 돌아갑니다');
    else if (!adv && snap.sv && !snap.sv.f) {
      const ready = alive.filter((p) => p.rd).length;
      const r = snap.sv.r;
      banner(`라운드 ${r} 준비${r % 10 === 0 ? ' · 보스 라운드!' : r % 5 === 0 ? ' · 정예 등장' : ''}`,
        `G 전투 시작 (${ready}/${alive.length}) · T 성 강화·무기 거치 · E 울타리 · R 터렛`);
    } else if (!adv && me && !me.al && me.rv > 0) {
      banner('쓰러졌어요', `${me.rv}초 뒤 캠프에서 부활합니다`);
    } else if (adv && snap.ar < 0 && snap.rs && map.rooms.filter((r) => r.type === 'battle' || r.type === 'boss').every((r) => snap.rs[r.id] === 'c')) {
      banner('모든 방 정복!', '팀원 모두 포털 위에 모이면 다음 스테이지로 출발합니다');
    } else if (adv && snap.ar < 0 && map.boss && !snap.po && snap.rs?.length) {
      const bossRoom = map.rooms.find((r) => r.type === 'boss');
      if (bossRoom && ['-', 'k'].includes(snap.rs[bossRoom.id]) && performance.now() % 6000 < 2500) banner('보스 스테이지', '미니맵의 ★ 방에 보스가 기다리고 있어요');
    }
  }

  // 화면 위쪽: 보스 체력바
  function drawBossBar(bs, y = 14) {
    const w = 420, x = (VIEW_W - w) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(x - 8, y - 4, w + 16, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bs.n, VIEW_W / 2, y + 10);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(x, y + 16, w, 9);
    ctx.fillStyle = bs.hp < bs.mh / 2 ? '#ff5252' : '#ef5350';
    ctx.fillRect(x, y + 16, (w * Math.max(0, bs.hp)) / bs.mh, 9);
  }

  // 왼쪽 아래: 스킬 트리 액티브 3칸 (1~3 키) + 패시브 2칸
  function drawLoadout(me, camp) {
    const ld = me.ld || [], pp = me.pp || [];
    if (!ld.length && !pp.length) return;
    const size = 52, gap = 6;
    const x0 = 14, y0 = VIEW_H - size - 14;
    pp.forEach((id, i) => {
      const n = NODE[id];
      if (!n) return;
      const x = x0 + 3 * (size + gap) + i * 44, y = y0 + 14;
      ctx.fillStyle = 'rgba(15,13,28,.85)';
      roundRect(x, y, 40, size - 14, 6);
      ctx.fill();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = ELEMENTS[n.el].color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ddd';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.name.slice(0, 4), x + 20, y + 17);
      ctx.fillStyle = '#9e9e9e';
      ctx.fillText('패시브', x + 20, y + 30);
    });
    for (let i = 0; i < 3; i++) {
      const id = ld[i], n = NODE[id];
      const x = x0 + i * (size + gap);
      ctx.fillStyle = 'rgba(15,13,28,.85)';
      roundRect(x, y0, size, size, 8);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = n ? ELEMENTS[n.el].color : 'rgba(255,255,255,.15)';
      ctx.stroke();
      ctx.fillStyle = '#9e9e9e';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(i + 1), x + 4, y0 + 11);
      if (!n) continue;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      // 이름이 길면 띄어쓰기에서 두 줄로 나눔 (블리자드 랜스 → 블리자드 / 랜스)
      const parts = n.name.includes(' ') ? n.name.split(' ') : [n.name];
      ctx.font = `bold ${parts.some((t) => t.length > 4) ? 10 : 11.5}px sans-serif`;
      parts.slice(0, 2).forEach((t, k) => ctx.fillText(t, x + size / 2, y0 + (parts.length > 1 ? 24 + k * 12 : 30)));
      if (me.cs?.[i] > 0) {
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        roundRect(x, y0, size, size, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(String(Math.ceil(me.cs[i])), x + size / 2, y0 + 30);
      }
    }
  }

  // ---------- 로비 ----------
  function label(text, x, y, color = '#fff', size = 12) {
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  let nearStatue = null;
  let ownedChars = ['knight'];
  // 동상 설명 말풍선 (캐릭터 위에 그림)
  function drawStatueTip(st) {
    const C = CHARACTERS[st.key];
    const own = ownedChars.includes(st.key);
    const lines = [`${C.name}  ·  체력 ${C.hp}  ·  마나 ${C.mana}`, `패시브 ${C.passive}: ${C.desc}`,
      own ? 'E 이 캐릭터로 바꾸기' : `E 사기  ◆${C.price}`];
    ctx.font = '12px sans-serif';
    const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 24;
    const x = Math.max(8, st.x - w / 2), y = st.y - 112;
    ctx.fillStyle = 'rgba(14,12,26,.92)';
    roundRect(x, y, w, 62, 8);
    ctx.fill();
    ctx.strokeStyle = C.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = C.color;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(lines[0], x + 12, y + 18);
    ctx.fillStyle = '#ddd';
    ctx.font = '12px sans-serif';
    ctx.fillText(lines[1], x + 12, y + 36);
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(lines[2], x + 12, y + 54);
  }

  function drawLobbyStations(L, snap, me, now) {
    nearStatue = null;
    const near = (o, r = 56) => me && Math.hypot(o.x - me.x, o.y - me.y) < r;
    // 캐릭터 동상
    for (const st of L.statues || []) {
      const C = CHARACTERS[st.key];
      const taken = snap.p.filter((p) => p.cr === st.key);
      ctx.fillStyle = '#3a3556';
      ctx.fillRect(st.x - 20, st.y + 8, 40, 10);
      ctx.fillStyle = '#4a4470';
      ctx.fillRect(st.x - 20, st.y + 6, 40, 4);
      if (sprites.ready) {
        ctx.save();
        ctx.globalAlpha = ownedChars.includes(st.key) ? 1 : 0.55;
        drawPlayerFrame(tintedPlayer(C.color, 'base', st.key), Math.floor(now / 300) % 4, st.x, st.y - 8, false, false);
        ctx.restore();
      }
      const own = ownedChars.includes(st.key);
      label(own ? C.name : `🔒 ${C.name} ◆${C.price}`, st.x, st.y + 30, !own ? '#9e9e9e' : C.color, 11);
      taken.forEach((p, i) => circle(st.x + 22 + i * 9, st.y - 18, 4, p.c));
      if (near(st, 50)) nearStatue = st;
    }
    // 옷장 (스킨)
    if (L.wardrobe) {
      const Wd = L.wardrobe;
      ctx.fillStyle = '#fff';
      ctx.fillRect(Wd.x - 20, Wd.y - 26, 40, 50);
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(Wd.x - 18, Wd.y - 24, 36, 46);
      ctx.fillStyle = '#8d6e63';
      ctx.fillRect(Wd.x - 1, Wd.y - 24, 2, 46);
      circle(Wd.x - 5, Wd.y, 2, '#ffd54f');
      circle(Wd.x + 5, Wd.y, 2, '#ffd54f');
      label('옷장', Wd.x, Wd.y + 40, '#ffcc80');
      if (near(Wd, 60)) label('E 스킨', Wd.x, Wd.y - 34, '#ffd54f');
    }
    // 병영 (군단 편성)
    if (L.barracks) {
      const B = L.barracks;
      ctx.fillStyle = '#fff'; ctx.fillRect(B.x - 28, B.y - 22, 56, 40);
      ctx.fillStyle = '#6d4c41'; ctx.fillRect(B.x - 26, B.y - 20, 52, 36);
      ctx.fillStyle = '#a1887f';
      ctx.beginPath(); ctx.moveTo(B.x - 32, B.y - 20); ctx.lineTo(B.x, B.y - 40); ctx.lineTo(B.x + 32, B.y - 20); ctx.fill();
      ctx.fillStyle = '#3e2723'; ctx.fillRect(B.x - 7, B.y - 2, 14, 18);
      ctx.fillStyle = '#e53935'; ctx.fillRect(B.x + 14, B.y - 50, 2, 16);
      ctx.fillRect(B.x + 16, B.y - 50, 10, 6);
      if (sprites.ready) {
        drawPlayerFrame(tintedPlayer('#90a4ae', { body: UNITS.knight.body, eye: '#ffffff' }, 'knight'), Math.floor(now / 250) % 4, B.x - 40, B.y - 4, false, false);
      }
      label('병영 · 군단', B.x, B.y + 34, '#90caf9');
      if (near(B, 60)) label('E 군단 편성', B.x, B.y - 56, '#ffd54f');
    }
    // 보급관 (전리품 상점)
    if (L.supply) {
      const Q = L.supply;
      ctx.fillStyle = '#fff'; ctx.fillRect(Q.x - 26, Q.y - 6, 52, 22);
      ctx.fillStyle = '#795548'; ctx.fillRect(Q.x - 24, Q.y - 4, 48, 18);
      for (const [dx, c] of [[-14, '#a1887f'], [0, '#8d6e63'], [14, '#a1887f']]) { ctx.fillStyle = c; ctx.fillRect(Q.x + dx - 6, Q.y - 16, 12, 12); }
      ctx.fillStyle = '#ffb74d'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✪', Q.x, Q.y + 11);
      label('보급관 (전리품)', Q.x, Q.y + 32, '#ffb74d');
      if (near(Q, 56)) label('E 보급품', Q.x, Q.y - 26, '#ffd54f');
    }
    // 길드 회관
    if (L.guild) {
      const G = L.guild;
      ctx.fillStyle = '#fff'; ctx.fillRect(G.x - 30, G.y - 24, 60, 42);
      ctx.fillStyle = '#37474f'; ctx.fillRect(G.x - 28, G.y - 22, 56, 38);
      ctx.fillStyle = '#546e7a'; for (let i = 0; i < 4; i++) ctx.fillRect(G.x - 28 + i * 16, G.y - 30, 10, 8);
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath(); ctx.moveTo(G.x - 10, G.y - 14); ctx.lineTo(G.x + 10, G.y - 14); ctx.lineTo(G.x + 10, G.y); ctx.lineTo(G.x, G.y + 8); ctx.lineTo(G.x - 10, G.y); ctx.fill();
      ctx.fillStyle = '#c62828'; ctx.fillRect(G.x - 2, G.y - 12, 4, 14);
      label('길드 회관', G.x, G.y + 34, '#ffd54f');
      if (near(G, 60)) label('E 길드', G.x, G.y - 40, '#ffd54f');
    }
    // 스킬 트리 제단
    const A = L.altar;
    const glow = 0.5 + Math.sin(now / 400) * 0.2;
    ctx.save();
    ctx.globalAlpha = glow;
    circle(A.x, A.y, 34, '#7e57c2');
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.fillRect(A.x - 24, A.y - 22, 48, 44);
    ctx.fillStyle = '#37305a';
    ctx.fillRect(A.x - 22, A.y - 20, 44, 40);
    ctx.strokeStyle = '#ce93d8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y + 12); ctx.lineTo(A.x, A.y - 4); ctx.lineTo(A.x - 10, A.y - 12);
    ctx.moveTo(A.x, A.y - 4); ctx.lineTo(A.x + 10, A.y - 12);
    ctx.moveTo(A.x, A.y + 4); ctx.lineTo(A.x - 12, A.y);
    ctx.moveTo(A.x, A.y + 4); ctx.lineTo(A.x + 12, A.y);
    ctx.stroke();
    label('스킬 트리', A.x, A.y + 40, '#ce93d8');
    if (near(A, 60)) label('E 열기', A.x, A.y - 32, '#ffd54f');
    // 포털
    for (const pt of L.portals) {
      const prog = snap.lpt && snap.lpt.m === pt.mode ? snap.lpt.t / 1.2 : 0;
      drawPortal(pt.x, pt.y, now, prog, pt.mode);
      label(pt.name, pt.x, pt.y + 60, pt.color, 13);
    }
    // 토템 자리 (준비 중)
    for (const t of L.totems) {
      ctx.fillStyle = '#2b2440';
      ctx.fillRect(t.x - 14, t.y - 14, 28, 28);
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(t.x - 14, t.y - 14, 28, 28);
      ctx.setLineDash([]);
      label('🔒', t.x, t.y + 5, '#fff', 12);
    }
    label('토템 (준비 중)', L.totems[1].x, L.totems[1].y + 30, '#6f6893', 11);
  }

  function drawLobbyHud(snap, me, extra) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    roundRect(10, 10, 230, 30 + snap.p.length * 22, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('LOBBY', 20, 30);
    ctx.fillStyle = '#80deea';
    ctx.textAlign = 'right';
    ctx.fillText(`◆ ${extra.essence ?? 0}  ✪ ${extra.spoils ?? 0}  ♛ ${extra.crowns ?? 0}`, 230, 30);
    ctx.textAlign = 'left';
    snap.p.forEach((p, i) => {
      const y = 52 + i * 22;
      ctx.fillStyle = p.c;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`${i + 1}P ${p.n}${p.id === snap.hid ? ' 👑' : ''}`, 20, y);
      ctx.fillStyle = CHARACTERS[p.cr]?.color || '#ddd';
      ctx.font = '12px sans-serif';
      ctx.fillText(CHARACTERS[p.cr]?.name || '', 160, y);
    });
    if (extra.build) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      roundRect(VIEW_W - 250, 10, 240, 48, 8);
      ctx.fill();
      ctx.textAlign = 'right';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = extra.build.color || '#fff';
      ctx.fillText(extra.build.title, VIEW_W - 20, 30);
      ctx.font = '11.5px sans-serif';
      ctx.fillStyle = '#bdb6d8';
      ctx.fillText(extra.build.sub, VIEW_W - 20, 48);
    }
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    roundRect(VIEW_W / 2 - 300, VIEW_H - 64, 600, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.fillText('동상 E 캐릭터 · 제단(K) 스킬 트리 · 옷장 · 병영 · 보급관 · 길드 회관 · 1~3 스킬 · 모두 포털에 들어가면 출발', VIEW_W / 2, VIEW_H - 48);
    if (snap.lp && snap.lpt) banner('출발할 수 없어요', snap.lp);
  }

  // ---------- 타이틀 화면 배경 ----------
  function title(now) {
    ctx.fillStyle = '#0e0d18';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    for (let ty = 0; ty < VIEW_H / TILE; ty++) {
      for (let tx = 0; tx < VIEW_W / TILE; tx++) {
        const d = Math.hypot(tx - 15, ty - 13) / 16;
        ctx.globalAlpha = Math.max(0, 1 - d);
        ctx.fillStyle = (tx + ty) % 2 ? '#1b1a2e' : '#1f1e34';
        ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    ctx.globalAlpha = 1;
    // 모닥불과 캐릭터
    const fx = VIEW_W / 2, fy = 470;
    ctx.save();
    ctx.globalAlpha = 0.25 + Math.sin(now / 120) * 0.05;
    circle(fx, fy, 120, '#ff7043');
    ctx.restore();
    drawCampfire(fx, fy, now);
    if (sprites.ready) {
      const colors = ['#ef5350', '#66bb6a', '#42a5f5', '#ffee58'];
      const spots = [[-110, -10, false], [110, -10, true], [-60, 40, false], [60, 40, true]];
      spots.forEach(([dx, dy, flip], i) => {
        const frame = Math.floor(now / 220 + i) % 4;
        drawPlayerFrame(tintedPlayer(colors[i], 'shadow', ['knight', 'ranger', 'berserker', 'mage'][i]), frame, fx + dx, fy + dy - 12, flip, false);
        drawWeaponSprite(['sword', 'bow', 'hammer', 'spear'][i], fx + dx, fy + dy - 8, PIXEL, flip ? Math.PI - 0.5 : -0.5, flip);
      });
    }
    // 떠다니는 불씨
    for (let i = 0; i < 18; i++) {
      const t = (now / 1000 + i * 0.37) % 4;
      const x = fx + Math.sin(i * 12.9 + t) * 80;
      const y = fy - t * 70;
      ctx.globalAlpha = Math.max(0, 1 - t / 4);
      circle(x, y, 2, i % 2 ? '#ffd54f' : '#ff7043');
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 메인 ----------
  function render(snap, map, myId, mouse, extra = {}) {
    const now = performance.now();
    showDamage = extra.damageNumbers !== false;
    ownedChars = extra.chars || ['knight'];
    const me = snap.p.find((p) => p.id === myId);
    const cam = cameraFor(map, me || map.spawn, extra.zoom || 1);
    ctx.fillStyle = '#0e0d18';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.scale(cam.z, cam.z); // 화면 확대: 세상 그리기 전체에 적용 (HUD는 그대로)
    drawMap(map, cam, snap);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawTraps(map, snap, now);
    if (map.camp) drawCampfire(map.camp.x, map.camp.y, now);
    if (map.portal) drawPortal(map.portal.x, map.portal.y, now, snap.pt, 'adv', !snap.po);
    if (map.lobby) drawLobbyStations(map.lobby, snap, me, now);
    const myBit = 1 << Math.max(0, snap.p.findIndex((p) => p.id === myId));
    for (const [id, k, x, y, m] of snap.xo || []) if (!(m & myBit)) drawOrb({ id, k, x, y }, now);
    for (const z of snap.zn || []) drawZone(z, now);
    for (const h of snap.hz || []) drawHazard(h, now);
    for (const [x, y] of snap.wm || []) drawSpawnMark(x, y, snap.wmt || 0, now);
    for (const c of snap.cs || []) drawChest(c);
    for (const o of snap.sh || []) drawShopItem(o, now, me);
    const dist = (o) => (me ? Math.hypot(o.x - me.x, o.y - me.y) : 1e9);
    // E로 상호작용할 대상 하나 (게임과 같은 순서: 상자 → 상점 → 무기)
    const chest = me?.al && (snap.cs || []).find((c) => !c.o && dist(c) < 48);
    const shopItem = me?.al && !chest && (snap.sh || []).filter((o) => !o.so && dist(o) < 38).sort((a, b) => dist(a) - dist(b))[0];
    const pick = me?.al && !chest && !shopItem && (snap.pk || []).filter((o) => dist(o) < 48).sort((a, b) => dist(a) - dist(b))[0];
    for (const o of snap.pk || []) drawPickup(o, now, o === pick);
    ctx.restore();

    for (const s of snap.st) drawStruct(s, cam);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    // 베이스캠프 건설 미리보기
    if (map.camp && me?.al) {
      const tx = Math.floor(mouse.x / TILE), ty = Math.floor(mouse.y / TILE);
      const inside = tx >= 0 && ty >= 0 && tx < map.cols && ty < map.rows
        && Math.hypot(tx * TILE + 16 - map.camp.x, ty * TILE + 16 - map.camp.y) <= map.camp.r;
      if (inside) {
        const occupied = snap.st.find((s) => s.tx === tx && s.ty === ty);
        const ok = !map.tiles[ty * map.cols + tx] && !occupied;
        ctx.strokeStyle = occupied ? 'rgba(255,138,101,.9)' : ok ? 'rgba(129,199,132,.9)' : 'rgba(229,115,115,.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
        ctx.setLineDash([]);
      }
    }
    for (const b of snap.b) drawBullet(b);
    // 성보다 위쪽(뒤)에 있는 유닛은 성 뒤에, 아래쪽(앞)은 성 앞에 그림
    const behind = (u) => snap.ca && u[3] < snap.ca.y + 20;
    for (const u of snap.un || []) if (behind(u)) drawUnit(u, snap, now);
    if (snap.ca) drawCastle(snap.ca, now);
    for (const u of snap.un || []) if (!behind(u)) drawUnit(u, snap, now);
    for (const e of snap.e) drawEnemy(e, now, me);
    for (const p of snap.p) drawPlayer(p, p.id === myId, now);
    drawFx(snap.fx);
    if (map.lobby && nearStatue) drawStatueTip(nearStatue);
    if (chest) label('E 열기', chest.x, chest.y - 24, '#ffd54f');
    if (pick) weaponTip(pick.k, pick.el, pick.lv, pick.x, pick.y - 12, 'E 줍기:', me);
    if (shopItem) {
      if (shopItem.kd === 'weapon') weaponTip(shopItem.k, shopItem.el, shopItem.lv, shopItem.x, shopItem.y - 16, `E 사기 ●${shopItem.pr}:`, me);
      else {
        const it = SHOP[shopItem.kd];
        label(`E 사기 ●${shopItem.pr}: ${it.name} (${it.desc})`, shopItem.x, shopItem.y - 26, '#ffd54f', 12);
      }
    }
    ctx.restore();
    ctx.restore(); // 확대 끝

    if (snap.ph === 'lobby') drawLobbyHud(snap, me, extra);
    else drawHud(snap, me, map);
    if (snap.ph === 'playing') drawCards(me, mouse, snap.md === 'camp');
    else cardRects = [];
    return cam;
  }

  function message(text) {
    ctx.fillStyle = '#0e0d18';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    banner(text);
  }

  return {
    render,
    message,
    title,
    cameraFor,
    cardAt(sx, sy) {
      return cardRects.findIndex((c) => sx >= c.x && sx <= c.x + c.w && sy >= c.y && sy <= c.y + c.h);
    },
  };
}
