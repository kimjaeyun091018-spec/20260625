// 캔버스 그리기 전담 (게임 규칙 없음)
import {
  TILE, VIEW_W, VIEW_H, STRUCTS, BUFFS, ELEMENTS, WEAPONS, SKILLS, offerInfo, stageLabel, weaponFam,
} from './data.js';

// tools/make_sprites.py의 WEAPON_ORDER와 같은 순서여야 합니다.
export const WEAPON_SPRITES = [
  'sword', 'greatsword', 'twinblades', 'spear', 'halberd', 'lance',
  'hammer', 'warhammer', 'quakehammer', 'bow', 'crossbow', 'longbow',
  'gun', 'shotgun', 'sniper', 'chest', 'chest_open',
];
const PIXEL = 2;            // 도트 1칸 = 화면 2픽셀
const GRIP_X = 3, GRIP_Y = 6; // 무기 그림에서 손잡이 위치

// ---------- 이미지 불러오기 ----------
const sprites = { ready: false, player: new Image(), weapons: new Image() };
{
  let left = 2;
  const done = () => { if (--left === 0) sprites.ready = true; };
  sprites.player.onload = done;
  sprites.weapons.onload = done;
  sprites.player.src = 'assets/player.png';
  sprites.weapons.src = 'assets/weapons.png';
}

// 원본 캐릭터의 바깥 흰 테두리만 플레이어 색으로 바꾼 시트 (눈·몸 안쪽 선은 흰색 유지)
const tintCache = new Map();
function tintedPlayer(color) {
  if (tintCache.has(color)) return tintCache.get(color);
  const img = sprites.player;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data, w = c.width, h = c.height;
  const isOpen = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const i = (y * w + x) * 4;
    return px[i + 3] === 0 || (px[i] === 80 && px[i + 1] === 73 && px[i + 2] === 73); // 투명 또는 그림자
  };
  const r = parseInt(color.slice(1, 3), 16), gg = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
  const out = new Uint8ClampedArray(px);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255 || px[i + 3] === 0) continue;
      if (isOpen(x + 1, y) || isOpen(x - 1, y) || isOpen(x, y + 1) || isOpen(x, y - 1)) {
        out[i] = r; out[i + 1] = gg; out[i + 2] = b;
      }
    }
  }
  g.putImageData(new ImageData(out, w, h), 0, 0);
  tintCache.set(color, c);
  return c;
}

// 로비·보상 화면(HTML)에서 쓰는 무기 아이콘
export function weaponIconHtml(key, scale = 2) {
  const i = WEAPON_SPRITES.indexOf(key);
  if (i < 0) return '';
  return `<span class="wsprite" style="width:${24 * scale}px;height:${12 * scale}px;background-size:${WEAPON_SPRITES.length * 24 * scale}px ${12 * scale}px;background-position:-${i * 24 * scale}px 0"></span>`;
}

const ENEMY_COLORS = { slime: '#66bb6a', archer: '#9575cd', brute: '#e57373' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let cardRects = [];
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
  function cameraFor(map, focus) {
    const mw = map.cols * TILE, mh = map.rows * TILE;
    const cx = mw <= VIEW_W ? (mw - VIEW_W) / 2 : Math.max(0, Math.min(mw - VIEW_W, focus.x - VIEW_W / 2));
    const cy = mh <= VIEW_H ? (mh - VIEW_H) / 2 : Math.max(0, Math.min(mh - VIEW_H, focus.y - VIEW_H / 2));
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  // ---------- 맵 ----------
  function drawMap(map, cam, snap) {
    ctx.fillStyle = '#0e0d18';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const tx0 = Math.max(0, Math.floor(cam.x / TILE)), ty0 = Math.max(0, Math.floor(cam.y / TILE));
    const tx1 = Math.min(map.cols - 1, Math.floor((cam.x + VIEW_W) / TILE));
    const ty1 = Math.min(map.rows - 1, Math.floor((cam.y + VIEW_H) / TILE));
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

  function drawPortal(x, y, now, progress) {
    ctx.save();
    ctx.translate(x, y);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = ['#7e57c2', '#b39ddb', '#ede7f6'][i];
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

  function drawStruct(s, cam) {
    const x = s.tx * TILE - cam.x, y = s.ty * TILE - cam.y, cx = x + TILE / 2, cy = y + TILE / 2;
    if (s.k === 'fence') {
      ctx.fillStyle = '#8d6e63';
      for (const ox of [3, 14, 25]) ctx.fillRect(x + ox, y + 6, 4, 22);
      ctx.fillStyle = '#a1887f';
      ctx.fillRect(x + 1, y + 10, 30, 4);
      ctx.fillRect(x + 1, y + 20, 30, 4);
    } else {
      ctx.fillStyle = '#546e7a';
      ctx.fillRect(x + 4, y + 4, 24, 24);
      circle(cx, cy, 8, '#90a4ae');
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(s.a);
      ctx.fillStyle = '#cfd8dc';
      ctx.fillRect(0, -3, 16, 6);
      ctx.restore();
    }
    if (s.hp < s.mh) hpBar(cx, y - 2, 26, s.hp, s.mh);
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

  function drawEnemy(e, now) {
    const color = e.h ? '#ffffff' : ENEMY_COLORS[e.k] || '#ccc';
    circle(e.x, e.y + e.r * 0.7, e.r * 0.9, 'rgba(0,0,0,.25)');
    if (e.k === 'slime') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + 2, e.r, e.r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      circle(e.x, e.y, e.r, color);
    }
    circle(e.x - e.r * 0.35, e.y - 2, 2.5, '#111');
    circle(e.x + e.r * 0.35, e.y - 2, 2.5, '#111');
    drawStatus(e, now);
    if (e.hp < e.mh) hpBar(e.x, e.y - e.r - 8, e.r * 2, e.hp, e.mh);
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
    const handX = p.x, handY = p.y + 4;

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
    if (p.al && weaponBehind) drawWeaponSprite(key, handX, handY, PIXEL, p.a, facingLeft);

    const sheet = sprites.ready ? tintedPlayer(p.c) : null;
    if (sheet) {
      let frame;
      if (!p.al) frame = 12;
      else if (p.mv) frame = 4 + (Math.floor(now / 75) % 8);
      else frame = Math.floor(now / 220) % 4;
      // 대시 잔상
      if (p.ds && p.al) {
        ctx.globalAlpha *= 0.35;
        drawPlayerFrame(sheet, frame, p.x, p.y, facingLeft, true);
        ctx.globalAlpha /= 0.35;
      }
      drawPlayerFrame(sheet, frame, p.x, p.y, facingLeft, false);
    } else {
      circle(p.x, p.y, 12, p.c);
    }
    if (p.al && !weaponBehind) drawWeaponSprite(key, handX, handY, PIXEL, p.a, facingLeft);
    ctx.restore();

    // 강화 활 차지 게이지
    if (p.ch > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(p.x - 16, p.y + 26, 32, 4);
      ctx.fillStyle = p.ch >= 0.99 ? '#ffd54f' : '#fff';
      ctx.fillRect(p.x - 16, p.y + 26, 32 * p.ch, 4);
    }

    ctx.fillStyle = isMe ? '#fff' : p.c;
    ctx.font = isMe ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'center';
    const tag = p.al ? `${p.pz ? '⏸ ' : ''}${p.n}${p.rd ? ' ✔' : ''}` : `${p.n} (쓰러짐)`;
    ctx.fillText(tag, p.x, p.y - 30);
  }

  function drawPlayerFrame(sheet, frame, x, y, flip, trail) {
    // 스프라이트의 (16, 25) = 발밑을 캐릭터 위치 아래 12px에 맞춤
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y + 12));
    if (flip) ctx.scale(-1, 1);
    if (trail) ctx.translate(-10, 0);
    ctx.drawImage(sheet, frame * 32, 0, 32, 32, -16 * PIXEL, -25 * PIXEL, 32 * PIXEL, 32 * PIXEL);
    ctx.restore();
  }

  function drawBullet(b) {
    const color = b.o ? '#ff5252' : ELEMENTS[b.el]?.color ?? '#ffffff';
    if (b.k === 'javelin') {
      drawWeaponSprite('spear', b.x, b.y, 1.5, b.st ? b.a : b.a, false, 1);
      return;
    }
    if (b.k === 'bow' || b.k === 'crossbow' || b.k === 'longbow') {
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
    ctx.drawImage(sprites.weapons, i * 24, 0, 24, 12, c.x - 24, c.y - 12, 48, 24);
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
    if (near) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      const el = ELEMENTS[o.el];
      ctx.fillText(`E 줍기: ${el ? `${el.name}의 ` : ''}${WEAPONS[o.k]?.name ?? ''}`, o.x, o.y - 18);
    }
  }

  function drawZone(z, now) {
    const color = ELEMENTS[z.el]?.color || '#ffffff';
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

  function drawOrb(o, now) {
    const bob = Math.sin(now / 200 + o.id) * 2;
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

  function drawCards(me, mouse) {
    cardRects = [];
    if (!me?.of) return;
    const w = 200, h = 84, gap = 14;
    const total = me.of.length * w + (me.of.length - 1) * gap;
    const y = VIEW_H - h - 44;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe082';
    ctx.font = 'bold 14px sans-serif';
    const more = me.oq > 0 ? ` (+${me.oq}장 대기)` : '';
    ctx.fillText(`레벨 업! 증강을 골라 주세요 (숫자키 또는 클릭)${more}`, Math.max(16, (VIEW_W - 190 - total) / 2), y - 8);
    me.of.forEach((key, i) => {
      const x = Math.max(16, (VIEW_W - 190 - total) / 2) + i * (w + gap);
      const hover = mouse.sx >= x && mouse.sx <= x + w && mouse.sy >= y && mouse.sy <= y + h;
      roundRect(x, y, w, h, 10);
      ctx.fillStyle = hover ? 'rgba(75,63,143,.97)' : 'rgba(30,27,52,.94)';
      ctx.fill();
      const info = offerInfo(key, me.bf, me.el, me.elv);
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = info.color;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(`[${i + 1}]`, x + 12, y + 24);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(info.name, x + 44, y + 24);
      ctx.fillStyle = '#b0aacc';
      ctx.font = '12px sans-serif';
      ctx.fillText(info.desc, x + 12, y + 50, w - 24);
      ctx.fillText(`Lv ${info.lv} / ${info.max}`, x + 12, y + 70);
      cardRects.push({ x, y, w, h });
    });
  }

  function drawMinimap(map, snap, myId) {
    if (!map.rooms.length) return;
    const cell = 22, size = cell * 5, x0 = VIEW_W - size - 14, y0 = 130;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(x0 - 6, y0 - 6, size + 12, size + 12);
    const codes = snap.rs || '';
    const known = (r) => codes[r.id] && codes[r.id] !== '-';
    const visible = (r) => known(r) || r.links.some((id) => known(map.rooms[id]));
    const center = (r) => [x0 + r.gx * cell + cell / 2, y0 + r.gy * cell + cell / 2];
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 3;
    for (const r of map.rooms) {
      if (!known(r)) continue;
      for (const id of r.links) {
        const [ax, ay] = center(r), [bx, by] = center(map.rooms[id]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
    }
    for (const r of map.rooms) {
      if (!visible(r)) continue;
      const c = codes[r.id];
      ctx.fillStyle = c === 'a' ? '#ef5350' : c === 'c' ? '#66bb6a' : c === 's' ? '#9e9e9e' : '#424242';
      ctx.fillRect(x0 + r.gx * cell + 4, y0 + r.gy * cell + 4, cell - 8, cell - 8);
      if (r.type === 'portal' && known(r)) {
        ctx.fillStyle = '#b39ddb';
        ctx.fillRect(x0 + r.gx * cell + 9, y0 + r.gy * cell + 7, cell - 18, cell - 14);
      }
    }
    for (const p of snap.p) {
      const gx = Math.floor(p.x / TILE / 22), gy = Math.floor(p.y / TILE / 22);
      const ox = ((p.x / TILE / 22) % 1) * cell, oy = ((p.y / TILE / 22) % 1) * cell;
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
      ctx.fillStyle = el ? el.color : '#fff';
      ctx.fillText(`${el ? `${el.name}의 ` : ''}${WEAPONS[cur.k].name}${el && el.name === ELEMENTS[me.el]?.name ? ' · 공명!' : ''}`, VIEW_W - 14, y0 - 30);
      ctx.font = '11.5px sans-serif';
      ctx.fillStyle = '#cfc8ee';
      ctx.fillText(`우클릭 ${S.skill.name} · Q ${S.ult.name} · 패시브 ${S.passive.name}${slots.length > 1 ? ' · Tab 교체' : ''}`, VIEW_W - 14, y0 - 12);
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
      // 스킬: 충전 개수 / 쿨타임
      if (s.c <= 0) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        roundRect(x, y, bw, bh, 8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.ceil(s.cd)}`, x + bw / 2, y + bh / 2 + 5);
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
    ctx.fillText(adv ? `스테이지 ${stageLabel(snap.si)}` : `웨이브 ${snap.w}`, 20, 32);
    if (!adv) {
      ctx.fillStyle = '#ffd54f';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`💰 ${snap.g}`, 175, 32);
    }
    if (me) {
      for (let i = 0; i < me.mh; i++) {
        ctx.fillStyle = i < me.hp ? '#ef5350' : '#555';
        ctx.fillRect(20 + i * 11, 42, 8, 12);
      }
      // 레벨 & 경험치
      ctx.fillStyle = '#69f0ae';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`Lv ${me.lv}`, 20, 72);
      ctx.fillStyle = '#333';
      ctx.fillRect(60, 64, 180, 8);
      ctx.fillStyle = '#69f0ae';
      ctx.fillRect(60, 64, (180 * me.xp) / me.xn, 8);
      ctx.fillStyle = '#ddd';
      ctx.font = '12px sans-serif';
      const el = ELEMENTS[me.el];
      ctx.fillStyle = el ? el.color : '#888';
      ctx.fillText(el ? `캐릭터 속성: ${el.name} Lv ${me.elv}` : '캐릭터 속성 없음', 20, 92);
      ctx.fillStyle = '#ddd';
      ctx.fillText(`점수 ${me.s}`, 190, 92);
      const owned = Object.entries(me.bf || {}).map(([k, n]) => `${BUFFS[k]?.name ?? k} ${n}`);
      if (owned.length) {
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.fillRect(10, 106, 240, 16 * owned.length + 8);
        ctx.fillStyle = '#c5b8ff';
        owned.forEach((t, i) => ctx.fillText(t, 20, 124 + i * 16));
      }
    }

    ctx.textAlign = 'right';
    ctx.font = '13px sans-serif';
    snap.p.forEach((p, i) => {
      ctx.fillStyle = p.c;
      ctx.fillText(`${p.rd ? '✔ ' : ''}${p.n} Lv${p.lv}  ${'♥'.repeat(Math.max(0, p.hp))}${p.al ? '' : ' ✕'}`, VIEW_W - 14, 52 + i * 18);
    });

    if (me) drawWeaponPanel(me);
    if (adv) drawMinimap(map, snap, me?.id);
    else {
      ctx.textAlign = 'left';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(10, VIEW_H - 34, 400, 24);
      ctx.fillStyle = '#eee';
      ctx.fillText(`캠프 안에서  E 울타리(${STRUCTS.fence.cost})  R 터렛(${STRUCTS.turret.cost})  F 철거 · 상자 근처에선 E 열기`, 18, VIEW_H - 18);
    }

    const alive = snap.p.filter((p) => p.al);
    if (snap.ph === 'over') banner(snap.ot, '잠시 후 로비로 돌아갑니다');
    else if (!adv && snap.e.length === 0) {
      const ready = alive.filter((p) => p.rd).length;
      banner(snap.w === 0 ? '베이스캠프를 준비하세요' : `웨이브 ${snap.w} 클리어!`,
        `다음 웨이브까지 ${Math.ceil(snap.wt)}초 · G 준비 완료 (${ready}/${alive.length}) · 캠프 안에서 체력 회복`);
    } else if (adv && snap.ar < 0 && snap.rs && !snap.rs.includes('-') && !snap.rs.includes('s')) {
      banner('모든 방 정복!', '팀원 모두 포털 위에 모이면 다음 스테이지로 출발합니다');
    }
  }

  // ---------- 메인 ----------
  function render(snap, map, myId, mouse) {
    const now = performance.now();
    const me = snap.p.find((p) => p.id === myId);
    const cam = cameraFor(map, me || map.spawn);
    drawMap(map, cam, snap);

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    if (map.camp) drawCampfire(map.camp.x, map.camp.y, now);
    if (map.portal) drawPortal(map.portal.x, map.portal.y, now, snap.pt);
    for (const o of snap.xo || []) if (!o.tk.includes(myId)) drawOrb(o, now);
    for (const z of snap.zn || []) drawZone(z, now);
    for (const c of snap.cs || []) drawChest(c);
    for (const o of snap.pk || []) drawPickup(o, now, me?.al && Math.hypot(o.x - me.x, o.y - me.y) < 48);
    if (me?.al) {
      const chest = (snap.cs || []).find((c) => !c.o && Math.hypot(c.x - me.x, c.y - me.y) < 48);
      if (chest) {
        ctx.fillStyle = '#ffd54f';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('E 열기', chest.x, chest.y - 20);
      }
    }
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
    for (const e of snap.e) drawEnemy(e, now);
    for (const p of snap.p) drawPlayer(p, p.id === myId, now);
    drawFx(snap.fx);
    ctx.restore();

    if (snap.ph !== 'lobby') drawHud(snap, me, map);
    if (snap.ph === 'playing') drawCards(me, mouse);
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
    cameraFor,
    cardAt(sx, sy) {
      return cardRects.findIndex((c) => sx >= c.x && sx <= c.x + c.w && sy >= c.y && sy <= c.y + c.h);
    },
  };
}
