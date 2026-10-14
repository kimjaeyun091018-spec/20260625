// 캔버스 그리기 전담 (게임 규칙 없음)
import {
  TILE, VIEW_W, VIEW_H, STRUCTS, BUFFS, ELEMENTS, WEAPONS, offerInfo, stageLabel,
} from './data.js';

const ENEMY_COLORS = { slime: '#66bb6a', archer: '#9575cd', brute: '#e57373' };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
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

  // 무기 모양 (플레이어 손에 들린 것)
  function drawWeapon(wp) {
    ctx.fillStyle = '#e0e0e0';
    ctx.strokeStyle = '#e0e0e0';
    switch (wp) {
      case 'sword':
        ctx.fillRect(8, -2, 22, 4);
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(5, -5, 4, 10);
        break;
      case 'spear':
        ctx.fillStyle = '#a1887f';
        ctx.fillRect(2, -1.5, 30, 3);
        ctx.fillStyle = '#e0e0e0';
        ctx.beginPath();
        ctx.moveTo(32, -5); ctx.lineTo(40, 0); ctx.lineTo(32, 5);
        ctx.fill();
        break;
      case 'hammer':
        ctx.fillStyle = '#a1887f';
        ctx.fillRect(4, -2, 18, 4);
        ctx.fillStyle = '#b0bec5';
        ctx.fillRect(20, -8, 9, 16);
        break;
      case 'bow':
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#a1887f';
        ctx.beginPath();
        ctx.arc(8, 0, 12, -1.2, 1.2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#eee';
        ctx.beginPath();
        ctx.moveTo(8 + Math.cos(-1.2) * 12, Math.sin(-1.2) * 12);
        ctx.lineTo(8 + Math.cos(1.2) * 12, Math.sin(1.2) * 12);
        ctx.stroke();
        break;
      default:
        ctx.fillRect(6, -3, 15, 6);
    }
  }

  function drawPlayer(p, isMe, now) {
    ctx.save();
    if (!p.al) ctx.globalAlpha = 0.35;
    else if (p.iv && Math.floor(now / 80) % 2) ctx.globalAlpha = 0.55;
    circle(p.x, p.y + 10, 10, 'rgba(0,0,0,.3)');
    if (p.el && ELEMENTS[p.el]) {
      ctx.strokeStyle = ELEMENTS[p.el].color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16 + Math.sin(now / 200) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    circle(p.x, p.y, 12, p.c);
    if (isMe) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    drawWeapon(p.wp);
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    const tag = p.al ? `${p.pz ? '⏸ ' : ''}${p.n}${p.rd ? ' ✔' : ''}` : `${p.n} (쓰러짐)`;
    ctx.fillText(tag, p.x, p.y - 22);
  }

  function drawBullet(b) {
    const color = b.o ? '#ff5252' : ELEMENTS[b.el]?.color ?? '#ffffff';
    if (b.k === 'bow') {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.a);
      ctx.fillStyle = color;
      ctx.fillRect(-12, -1.5, 16, 3);
      ctx.beginPath();
      ctx.moveTo(4, -4); ctx.lineTo(10, 0); ctx.lineTo(4, 4);
      ctx.fill();
      ctx.restore();
    } else {
      circle(b.x, b.y, b.r, color);
    }
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
    ctx.fillText(`레벨 업! 증강을 골라 주세요 (숫자키 또는 클릭)${more}`, (VIEW_W - total) / 2, y - 8);
    me.of.forEach((key, i) => {
      const x = (VIEW_W - total) / 2 + i * (w + gap);
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
    const cell = 26, size = cell * 5, x0 = VIEW_W - size - 14, y0 = VIEW_H - size - 14;
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
      ctx.fillText(`${WEAPONS[me.wp]?.icon ?? ''} ${WEAPONS[me.wp]?.name ?? ''}`, 20, 92);
      const el = ELEMENTS[me.el];
      ctx.fillStyle = el ? el.color : '#888';
      ctx.fillText(el ? `${el.name} 속성 Lv ${me.elv}` : '속성 없음', 90, 92);
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

    if (adv) drawMinimap(map, snap, me?.id);
    else {
      ctx.textAlign = 'left';
      ctx.font = '12px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(10, VIEW_H - 34, 330, 24);
      ctx.fillStyle = '#eee';
      ctx.fillText(`캠프 안에서  E 울타리(${STRUCTS.fence.cost})  R 터렛(${STRUCTS.turret.cost})  F 철거(반값 환불)`, 18, VIEW_H - 18);
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
