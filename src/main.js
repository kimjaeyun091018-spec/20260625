import {
  WIDTH, HEIGHT, TILE, COLS, ROWS, MAP, MAX_PLAYERS, CAMP, STRUCTS, BUFFS, inCamp,
  createState, addPlayer, removePlayer, step, snapshot, sanitizeInput, sanitizeName,
} from './game.js';
import { makeRoomCode, hostRoom, joinRoom, describeError } from './net.js';

const STEP = 1 / 60;          // 시뮬레이션 간격
const SEND_STATE_MS = 50;     // 방장 → 참가자 상태 전송 (초당 20번)
const SEND_INPUT_MS = 33;     // 참가자 → 방장 입력 전송 (초당 30번)
const INTERP_DELAY_MS = 100;  // 참가자 화면 보간 지연

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = WIDTH;
canvas.height = HEIGHT;

const ui = {
  menu: document.getElementById('menu'),
  name: document.getElementById('name'),
  solo: document.getElementById('soloBtn'),
  host: document.getElementById('hostBtn'),
  code: document.getElementById('code'),
  join: document.getElementById('joinBtn'),
  status: document.getElementById('status'),
  roomInfo: document.getElementById('roomInfo'),
};

// ---------- 입력 (키보드 + 마우스) ----------
// 누르고 있는 동안 유지되는 키
const HOLD_KEYS = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
};
// 한 번 누르면 한 번 실행되는 키
const ACTION_KEYS = {
  KeyE: 'fence', KeyR: 'turret', KeyF: 'demolish', KeyG: 'ready',
  Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3',
  Numpad1: 'pick1', Numpad2: 'pick2', Numpad3: 'pick3',
};
const keys = new Set();
const mouse = { x: WIDTH / 2, y: HEIGHT / 2, down: false };
const actionQueue = [];
let actionSeq = 0;
let cardRects = []; // 화면에 그려진 강화 카드 위치 (클릭 선택용)

window.addEventListener('keydown', (e) => {
  if (!session) return;
  if (e.code === 'Escape') { leave(); return; }
  const hold = HOLD_KEYS[e.code];
  if (hold) { keys.add(hold); e.preventDefault(); }
  const act = ACTION_KEYS[e.code];
  if (act && !e.repeat) { actionQueue.push(act); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = HOLD_KEYS[e.code];
  if (k) keys.delete(k);
});
window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });

function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  mouse.x = ((ev.clientX - r.left) * WIDTH) / r.width;
  mouse.y = ((ev.clientY - r.top) * HEIGHT) / r.height;
}
// pointer 이벤트라 마우스뿐 아니라 펜/터치로도 조준+사격이 됩니다(태블릿 테스트용).
canvas.addEventListener('pointermove', toWorld);
canvas.addEventListener('pointerdown', (e) => {
  toWorld(e);
  if (e.button !== 0) return;
  const card = cardRects.findIndex((c) => mouse.x >= c.x && mouse.x <= c.x + c.w && mouse.y >= c.y && mouse.y <= c.y + c.h);
  if (card >= 0) { actionQueue.push(`pick${card + 1}`); return; }
  mouse.down = true;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('pointercancel', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// 호출할 때마다 쌓인 행동을 하나씩 꺼내 보냅니다(seq가 바뀌면 방장이 한 번 실행).
function readInput(me) {
  const act = actionQueue.shift() || null;
  if (act) actionSeq++;
  return {
    up: keys.has('up'), down: keys.has('down'), left: keys.has('left'), right: keys.has('right'),
    dash: keys.has('dash'), fire: mouse.down,
    aim: me ? Math.atan2(mouse.y - me.y, mouse.x - me.x) : 0,
    act, seq: actionSeq, bx: Math.round(mouse.x), by: Math.round(mouse.y),
  };
}

// ---------- 세션 (혼자 / 방장 / 참가자) ----------
let session = null;

const playerName = () => sanitizeName(ui.name.value);
const setStatus = (msg) => { ui.status.textContent = msg; };
function setBusy(busy) {
  for (const b of [ui.solo, ui.host, ui.join]) b.disabled = busy;
}

function enterGame(label) {
  ui.menu.hidden = true;
  ui.roomInfo.hidden = false;
  ui.roomInfo.textContent = `${label} · Esc 나가기`;
  setStatus('');
  setBusy(false);
  keys.clear();
  actionQueue.length = 0;
  mouse.down = false;
}

function leave(reason = '') {
  if (!session) return;
  session.net?.close();
  session = null;
  cardRects = [];
  ui.menu.hidden = false;
  ui.roomInfo.hidden = true;
  setBusy(false);
  setStatus(reason);
}

async function startHost(solo) {
  setBusy(true);
  const state = createState();
  const inputs = {};
  const myId = 'host';
  addPlayer(state, myId, playerName());

  let net = null;
  if (!solo) {
    setStatus('방을 만드는 중…');
    for (let attempt = 0; attempt < 3 && !net; attempt++) {
      try {
        net = await hostRoom(makeRoomCode(), {
          onJoin(id, name) {
            if (Object.keys(state.players).length >= MAX_PLAYERS) return false;
            return !!addPlayer(state, id, name);
          },
          onInput(id, input) { inputs[id] = sanitizeInput(input); },
          onLeave(id) { removePlayer(state, id); delete inputs[id]; },
          onError(err) { console.warn('[net]', err); },
        });
      } catch (err) {
        if (err?.type !== 'unavailable-id' || attempt === 2) {
          setStatus(`방을 만들지 못했어요: ${describeError(err)}`);
          setBusy(false);
          return;
        }
      }
    }
  }

  session = { mode: 'host', myId, state, inputs, net, acc: 0, last: performance.now(), lastSend: 0 };
  enterGame(solo ? '혼자 하기' : `방 코드: ${net.code} (친구에게 알려주세요)`);
}

async function startClient() {
  const code = ui.code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { setStatus('방 코드 5자리를 입력해 주세요.'); return; }
  setBusy(true);
  setStatus('접속하는 중…');

  const s = { mode: 'client', myId: null, buffer: [], lastSend: 0, net: null };
  try {
    s.net = await joinRoom(code, playerName(), {
      onWelcome(id) { s.myId = id; },
      onState(snap) {
        s.buffer.push({ t: performance.now(), s: snap });
        if (s.buffer.length > 30) s.buffer.shift();
      },
      onClose(reason) { if (session === s) leave(reason); },
    });
  } catch (err) {
    setStatus(`접속 실패: ${describeError(err)}`);
    setBusy(false);
    return;
  }
  session = s;
  enterGame(`방 코드: ${code}`);
}

// 탭을 닫거나 새로고침하면 상대방에게 바로 퇴장이 전달되도록 연결을 닫습니다.
window.addEventListener('pagehide', () => session?.net?.close());

ui.solo.addEventListener('click', () => startHost(true));
ui.host.addEventListener('click', () => startHost(false));
ui.join.addEventListener('click', startClient);
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient(); });
try { ui.name.value = localStorage.getItem('sk-name') || ''; } catch { /* 저장소 사용 불가 */ }
ui.name.addEventListener('change', () => {
  try { localStorage.setItem('sk-name', ui.name.value); } catch { /* 무시 */ }
});

// ---------- 프레임 ----------
function hostFrame(s, now) {
  const dt = Math.min((now - s.last) / 1000, 0.1);
  s.last = now;
  s.acc += dt;
  s.inputs[s.myId] = readInput(s.state.players[s.myId]);
  while (s.acc >= STEP) {
    step(s.state, s.inputs, STEP);
    s.acc -= STEP;
  }
  const snap = snapshot(s.state);
  if (s.net && now - s.lastSend >= SEND_STATE_MS) {
    s.net.broadcast({ t: 's', s: snap });
    s.lastSend = now;
  }
  render(snap, s.myId);
}

const lerp = (a, b, t) => a + (b - a) * t;

function lerpList(a, b, t) {
  const prev = new Map(a.map((o) => [o.id, o]));
  return b.map((o) => {
    const p = prev.get(o.id);
    return p ? { ...o, x: lerp(p.x, o.x, t), y: lerp(p.y, o.y, t) } : o;
  });
}

// 받은 상태 두 개 사이를 부드럽게 이어서 그립니다.
function interpolated(buffer, now) {
  if (buffer.length === 0) return null;
  const rt = now - INTERP_DELAY_MS;
  for (let i = buffer.length - 2; i >= 0; i--) {
    const a = buffer[i], b = buffer[i + 1];
    if (a.t <= rt && rt <= b.t) {
      const t = (rt - a.t) / (b.t - a.t || 1);
      return { ...b.s, p: lerpList(a.s.p, b.s.p, t), e: lerpList(a.s.e, b.s.e, t) };
    }
  }
  return rt < buffer[0].t ? buffer[0].s : buffer[buffer.length - 1].s;
}

function clientFrame(s, now) {
  const snap = interpolated(s.buffer, now);
  const me = snap?.p.find((p) => p.id === s.myId);
  if (now - s.lastSend >= SEND_INPUT_MS) {
    s.net.send({ t: 'in', i: readInput(me) });
    s.lastSend = now;
  }
  // 강화 카드/골드는 최신 상태로 보여 줍니다(보간 X).
  const latest = s.buffer[s.buffer.length - 1]?.s;
  if (snap && latest) render({ ...snap, g: latest.g, p: snap.p.map((p) => ({ ...p, of: latest.p.find((q) => q.id === p.id)?.of ?? p.of })) }, s.myId);
  else { drawMap(); centerText('상태를 받는 중…'); }
}

function loop(now) {
  if (session?.mode === 'host') hostFrame(session, now);
  else if (session?.mode === 'client') clientFrame(session, now);
  else drawMap();
  requestAnimationFrame(loop);
}

// ---------- 그리기 ----------
const mapCanvas = document.createElement('canvas');
mapCanvas.width = WIDTH;
mapCanvas.height = HEIGHT;
(function prerenderMap() {
  const m = mapCanvas.getContext('2d');
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * TILE, py = y * TILE;
      if (MAP[y][x]) {
        m.fillStyle = '#2b2440';
        m.fillRect(px, py, TILE, TILE);
        m.fillStyle = '#3d3460';
        m.fillRect(px, py, TILE, 6);
      } else {
        const camp = inCamp(x, y);
        m.fillStyle = camp
          ? ((x + y) % 2 ? '#262035' : '#2a2339')
          : ((x + y) % 2 ? '#1b1a2e' : '#1f1e34');
        m.fillRect(px, py, TILE, TILE);
      }
    }
  }
  // 캠프 경계선
  m.strokeStyle = 'rgba(255, 183, 77, .35)';
  m.setLineDash([8, 8]);
  m.lineWidth = 2;
  m.beginPath();
  m.arc(CAMP.x, CAMP.y, CAMP.r + TILE / 2, 0, Math.PI * 2);
  m.stroke();
})();

function drawMap() {
  ctx.drawImage(mapCanvas, 0, 0);
}

function drawCampfire(now) {
  const flick = Math.sin(now / 90) * 2;
  circle(CAMP.x, CAMP.y + 6, 12, '#5d4037');
  circle(CAMP.x, CAMP.y, 9 + flick * 0.5, '#ff7043');
  circle(CAMP.x, CAMP.y - 3, 5 + flick * 0.3, '#ffd54f');
}

function circle(x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function hpBar(x, y, w, hp, max) {
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(x - w / 2, y, w, 4);
  ctx.fillStyle = '#ef5350';
  ctx.fillRect(x - w / 2, y, (w * Math.max(0, hp)) / max, 4);
}

function drawStruct(s) {
  const x = s.tx * TILE, y = s.ty * TILE, cx = x + TILE / 2, cy = y + TILE / 2;
  if (s.k === 'fence') {
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(x + 3, y + 6, 4, 22);
    ctx.fillRect(x + 14, y + 6, 4, 22);
    ctx.fillRect(x + 25, y + 6, 4, 22);
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

// 마우스가 캠프 안이면 건설 가능 여부를 칸으로 보여 줍니다.
function drawBuildPreview(snap, me) {
  if (!me?.al) return;
  const tx = Math.floor(mouse.x / TILE), ty = Math.floor(mouse.y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || !inCamp(tx, ty)) return;
  const occupied = snap.st.find((s) => s.tx === tx && s.ty === ty);
  const ok = !MAP[ty][tx] && !occupied;
  ctx.strokeStyle = occupied ? 'rgba(255,138,101,.9)' : ok ? 'rgba(129,199,132,.9)' : 'rgba(229,115,115,.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
  ctx.setLineDash([]);
}

const ENEMY_COLORS = { slime: '#66bb6a', archer: '#9575cd', brute: '#e57373' };

function drawEnemy(e) {
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
  if (e.hp < e.mh) hpBar(e.x, e.y - e.r - 8, e.r * 2, e.hp, e.mh);
}

function drawPlayer(p, isMe, now) {
  ctx.save();
  if (!p.al) ctx.globalAlpha = 0.35;
  else if (p.iv && Math.floor(now / 80) % 2) ctx.globalAlpha = 0.55;

  circle(p.x, p.y + 10, 10, 'rgba(0,0,0,.3)');
  circle(p.x, p.y, 12, p.c);
  if (isMe) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(6, -3, 15, 6);
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  const tag = p.al ? `${p.n}${p.rd ? ' ✔' : ''}` : `${p.n} (다음 웨이브에 부활)`;
  ctx.fillText(tag, p.x, p.y - 20);
}

function centerText(text, sub = '') {
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  roundRect(WIDTH / 2 - 280, 100, 560, sub ? 76 : 52, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(text, WIDTH / 2, 134);
  if (sub) {
    ctx.font = '15px sans-serif';
    ctx.fillText(sub, WIDTH / 2, 162);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function drawBuffCards(me) {
  cardRects = [];
  if (!me?.of) return;
  const w = 200, h = 84, gap = 14;
  const total = me.of.length * w + (me.of.length - 1) * gap;
  const y = HEIGHT - h - 44;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffe082';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText('강화를 골라 주세요 (숫자키 또는 클릭)', (WIDTH - total) / 2, y - 8);
  me.of.forEach((key, i) => {
    const x = (WIDTH - total) / 2 + i * (w + gap);
    const hover = mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
    roundRect(x, y, w, h, 10);
    ctx.fillStyle = hover ? 'rgba(75,63,143,.97)' : 'rgba(30,27,52,.94)';
    ctx.fill();
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.stroke();
    const def = BUFFS[key];
    const lv = (me.bf?.[key] || 0) + 1;
    ctx.fillStyle = '#ffd54f';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`[${i + 1}]`, x + 12, y + 24);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(def.name, x + 44, y + 24);
    ctx.fillStyle = '#b0aacc';
    ctx.font = '13px sans-serif';
    ctx.fillText(def.desc, x + 12, y + 50);
    ctx.fillText(`Lv ${lv} / ${def.max}`, x + 12, y + 70);
    cardRects.push({ x, y, w, h });
  });
}

function drawHud(snap, me) {
  // 왼쪽 위: 웨이브, 체력, 점수, 골드
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(10, 10, 230, 80);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(`웨이브 ${snap.w}`, 20, 32);
  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(`💰 ${snap.g}`, 170, 32);
  if (me) {
    for (let i = 0; i < me.mh; i++) {
      ctx.fillStyle = i < me.hp ? '#ef5350' : '#555';
      ctx.fillRect(20 + i * 13, 42, 10, 12);
    }
    ctx.fillStyle = '#ddd';
    ctx.font = '12px sans-serif';
    ctx.fillText(`점수 ${me.s}`, 20, 76);
    // 보유 강화
    const owned = Object.entries(me.bf || {}).map(([k, n]) => `${BUFFS[k]?.name ?? k} ${n}`);
    if (owned.length) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(10, 94, 230, 16 * owned.length + 8);
      ctx.fillStyle = '#c5b8ff';
      owned.forEach((t, i) => ctx.fillText(t, 20, 112 + i * 16));
    }
  }

  // 오른쪽 위: 팀원
  ctx.textAlign = 'right';
  ctx.font = '13px sans-serif';
  snap.p.forEach((p, i) => {
    ctx.fillStyle = p.c;
    ctx.fillText(`${p.rd ? '✔ ' : ''}${p.n}  ${'♥'.repeat(p.hp)}${p.al ? '' : ' ✕'}`, WIDTH - 14, 52 + i * 18);
  });

  // 왼쪽 아래: 건설 안내
  ctx.textAlign = 'left';
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(10, HEIGHT - 34, 330, 24);
  ctx.fillStyle = '#eee';
  ctx.fillText(
    `캠프 안에서  E 울타리(${STRUCTS.fence.cost})  R 터렛(${STRUCTS.turret.cost})  F 철거(반값 환불)`,
    18, HEIGHT - 18,
  );

  const alive = snap.p.filter((p) => p.al);
  if (snap.go) centerText('전멸!', '잠시 후 다시 시작합니다');
  else if (snap.e.length === 0) {
    const ready = alive.filter((p) => p.rd).length;
    const title = snap.w === 0 ? '베이스캠프를 준비하세요' : `웨이브 ${snap.w} 클리어!`;
    centerText(title, `다음 웨이브까지 ${Math.ceil(snap.wt)}초 · G 준비 완료 (${ready}/${alive.length}) · 캠프 안에서 체력 회복`);
  }
}

function render(snap, myId) {
  const now = performance.now();
  const me = snap.p.find((p) => p.id === myId);
  drawMap();
  drawCampfire(now);
  for (const s of snap.st) drawStruct(s);
  drawBuildPreview(snap, me);
  for (const b of snap.b) circle(b.x, b.y, b.r, b.o ? '#ff5252' : '#ffee58');
  for (const e of snap.e) drawEnemy(e);
  for (const p of snap.p) drawPlayer(p, p.id === myId, now);
  drawHud(snap, me);
  drawBuffCards(me);
}

requestAnimationFrame(loop);
