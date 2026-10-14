import { VIEW_W, VIEW_H, MAX_PLAYERS, WEAPONS, WEAPON_KEYS, MODES, sameWeaponLimit, stageLabel, offerInfo } from './data.js';
import {
  createState, addPlayer, removePlayer, step, snapshot, sanitizeInput, sanitizeName,
} from './game.js';
import { packMap, unpackMap } from './maps.js';
import { makeRoomCode, hostRoom, joinRoom, describeError } from './net.js';
import { createRenderer, weaponIconHtml } from './render.js';

const STEP = 1 / 60;          // 시뮬레이션 간격
const SEND_STATE_MS = 50;     // 방장 → 참가자 상태 전송 (초당 20번)
const SEND_INPUT_MS = 33;     // 참가자 → 방장 입력 전송 (초당 30번)
const INTERP_DELAY_MS = 100;  // 참가자 화면 보간 지연

const canvas = document.getElementById('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const renderer = createRenderer(canvas);

const $ = (id) => document.getElementById(id);
const ui = {
  menu: $('menu'), name: $('name'), solo: $('soloBtn'), host: $('hostBtn'), code: $('code'), join: $('joinBtn'),
  status: $('status'), roomInfo: $('roomInfo'),
  pause: $('pause'), pauseNote: $('pauseNote'), resume: $('resumeBtn'), quit: $('quitBtn'),
  lobby: $('lobby'), lobbyRoom: $('lobbyRoom'), slots: $('slots'), weapons: $('weapons'), modes: $('modes'),
  lobbyMsg: $('lobbyMsg'), startBtn: $('startBtn'),
  stage: $('stage'), stageTitle: $('stageTitle'), stageSub: $('stageSub'), stageSlots: $('stageSlots'), rewards: $('rewardCards'),
};

// ---------- 입력 (키보드 + 마우스) ----------
const HOLD_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
};
const ACTION_KEYS = {
  KeyE: 'fence', KeyR: 'turret', KeyF: 'demolish', KeyG: 'ready',
  KeyQ: 'ult', Tab: 'swap',
  Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Numpad1: 'pick1', Numpad2: 'pick2', Numpad3: 'pick3',
};
const keys = new Set();
// sx/sy: 화면 좌표, x/y: 맵(월드) 좌표
const mouse = { sx: VIEW_W / 2, sy: VIEW_H / 2, x: 0, y: 0, down: false };
let cam = { x: 0, y: 0 };
const actionQueue = [];
let actionSeq = 0;

const pushAction = (act) => { if (session && !session.paused) actionQueue.push(act); };

window.addEventListener('keydown', (e) => {
  if (!session) return;
  if (e.code === 'Escape') { setPaused(!session.paused); e.preventDefault(); return; }
  if (session.paused || e.target instanceof HTMLInputElement) return;
  const hold = HOLD_KEYS[e.code];
  if (hold) { keys.add(hold); e.preventDefault(); }
  let act = ACTION_KEYS[e.code];
  if (act && session.lastPhase === 'transition' && act.startsWith('pick')) act = `reward${act[4]}`;
  if (act && !e.repeat) { pushAction(act); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = HOLD_KEYS[e.code];
  if (k) keys.delete(k);
});
window.addEventListener('blur', () => {
  keys.clear();
  mouse.down = false;
  if (session?.solo) setPaused(true); // 혼자 하기 중 다른 창/앱으로 가면 자동으로 멈춤
});

function toScreen(ev) {
  const r = canvas.getBoundingClientRect();
  mouse.sx = ((ev.clientX - r.left) * VIEW_W) / r.width;
  mouse.sy = ((ev.clientY - r.top) * VIEW_H) / r.height;
}
// pointer 이벤트라 펜/터치로도 조준+사격이 됩니다(태블릿 테스트용).
canvas.addEventListener('pointermove', toScreen);
canvas.addEventListener('pointerdown', (e) => {
  toScreen(e);
  if ((e.button !== 0 && e.button !== 2) || session?.paused) return;
  const card = renderer.cardAt(mouse.sx, mouse.sy);
  if (card >= 0) { pushAction(`pick${card + 1}`); return; }
  if (e.button === 2) { pushAction('skill'); return; }
  mouse.down = true;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('pointercancel', () => { mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// 마우스 휠 = 무기 교체 (너무 빨리 여러 번 바뀌지 않게 0.3초 간격)
let lastWheel = 0;
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (performance.now() - lastWheel > 300) { lastWheel = performance.now(); pushAction('swap'); }
}, { passive: false });

// 로비·보상 화면의 버튼은 data-act 값을 행동으로 보냅니다.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) pushAction(el.dataset.act);
});

function readInput(me) {
  mouse.x = mouse.sx + cam.x;
  mouse.y = mouse.sy + cam.y;
  if (session?.paused) return { aim: me?.a ?? me?.angle ?? 0, seq: actionSeq, pz: true };
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

function enterSession(label) {
  ui.menu.hidden = true;
  ui.roomInfo.hidden = false;
  ui.roomInfo.textContent = `${label} · Esc 일시정지`;
  setStatus('');
  setBusy(false);
  keys.clear();
  actionQueue.length = 0;
  mouse.down = false;
}

function setPaused(paused) {
  if (!session || session.paused === paused) return;
  session.paused = paused;
  ui.pause.hidden = !paused;
  ui.pauseNote.textContent = session.solo
    ? '게임이 멈춰 있어요.'
    : '멀티플레이 중에는 게임이 계속 진행돼요. 내 캐릭터는 그 자리에 멈춰 있습니다.';
  keys.clear();
  actionQueue.length = 0;
  mouse.down = false;
  if (!paused && session.mode === 'host') session.last = performance.now();
  if (paused) ui.resume.focus();
}
ui.resume.addEventListener('click', () => setPaused(false));
ui.quit.addEventListener('click', () => leave());

function leave(reason = '') {
  if (!session) return;
  session.net?.close();
  session = null;
  for (const el of [ui.pause, ui.lobby, ui.stage, ui.roomInfo]) el.hidden = true;
  ui.menu.hidden = false;
  overlayCache.lobby = overlayCache.stage = '';
  setBusy(false);
  setStatus(reason);
}

async function startHost(solo) {
  setBusy(true);
  const myId = 'host';
  const state = createState(myId);
  const inputs = {};
  addPlayer(state, myId, playerName());

  let net = null;
  if (!solo) {
    setStatus('방을 만드는 중…');
    for (let attempt = 0; attempt < 3 && !net; attempt++) {
      try {
        net = await hostRoom(makeRoomCode(), {
          onJoin(id, name) {
            if (Object.keys(state.players).length >= MAX_PLAYERS) return false;
            const ok = !!addPlayer(state, id, name);
            if (ok && session) session.mapDirty = true; // 새로 온 사람에게 맵 보내기
            return ok;
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

  session = {
    mode: 'host', solo, paused: false, myId, state, inputs, net, code: net?.code,
    acc: 0, last: performance.now(), lastSend: 0, sentMapId: null, mapDirty: true, lastPhase: 'lobby',
  };
  enterSession(solo ? '혼자 하기' : `방 코드: ${net.code} (친구에게 알려주세요)`);
}

async function startClient() {
  const code = ui.code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) { setStatus('방 코드 5자리를 입력해 주세요.'); return; }
  setBusy(true);
  setStatus('접속하는 중…');

  const s = {
    mode: 'client', solo: false, paused: false, myId: null, buffer: [], lastSend: 0, net: null,
    map: null, code, lastPhase: 'lobby',
  };
  try {
    s.net = await joinRoom(code, playerName(), {
      onWelcome(id) { s.myId = id; },
      onState(snap) {
        s.buffer.push({ t: performance.now(), s: snap });
        if (s.buffer.length > 30) s.buffer.shift();
      },
      onMap(m) { s.map = unpackMap(m); },
      onClose(reason) { if (session === s) leave(reason); },
    });
  } catch (err) {
    setStatus(`접속 실패: ${describeError(err)}`);
    setBusy(false);
    return;
  }
  session = s;
  enterSession(`방 코드: ${code}`);
}

window.addEventListener('pagehide', () => session?.net?.close());
ui.solo.addEventListener('click', () => startHost(true));
ui.host.addEventListener('click', () => startHost(false));
ui.join.addEventListener('click', startClient);
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient(); });
try { ui.name.value = localStorage.getItem('sk-name') || ''; } catch { /* 저장소 사용 불가 */ }
ui.name.addEventListener('change', () => {
  try { localStorage.setItem('sk-name', ui.name.value); } catch { /* 무시 */ }
});

// ---------- 로비 / 스테이지 화면 (HTML) ----------
const overlayCache = { lobby: '', stage: '' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function slotHtml(snap, extra) {
  let html = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = snap.p[i];
    if (!p) { html += `<div class="slot empty"><b>${i + 1}P</b><span>비어 있음</span></div>`; continue; }
    const w = WEAPONS[p.wp];
    html += `<div class="slot" style="--c:${p.c}"><b>${i + 1}P</b>
      <span class="pname">${esc(p.n)}${p.id === snap.hid ? ' 👑' : ''}</span>
      <span class="pweap">${w ? `${weaponIconHtml(p.ws?.[p.sl]?.k || p.wp, 1.5)} ${WEAPONS[p.ws?.[p.sl]?.k]?.name || w.name}` : '무기 선택 중…'}</span>${extra ? extra(p) : ''}</div>`;
  }
  return html;
}

function updateLobby(snap, myId) {
  const me = snap.p.find((p) => p.id === myId);
  const isHost = myId === snap.hid;
  const key = JSON.stringify([snap.p.map((p) => [p.id, p.n, p.wp, p.c]), snap.md, snap.lp, isHost]);
  if (key === overlayCache.lobby) return;
  overlayCache.lobby = key;

  ui.lobbyRoom.textContent = session.solo ? '혼자 하기' : `방 코드 ${session.code} · 친구에게 알려 주세요`;
  ui.slots.innerHTML = slotHtml(snap);

  const limit = sameWeaponLimit(snap.p.length);
  ui.weapons.innerHTML = WEAPON_KEYS.map((k) => {
    const w = WEAPONS[k];
    const others = snap.p.filter((p) => p.wp === k && p.id !== myId).length;
    const mine = me?.wp === k;
    const full = !mine && others >= limit;
    return `<button class="weapon${mine ? ' selected' : ''}" data-act="weapon:${k}" ${full ? 'disabled' : ''}>
      ${weaponIconHtml(k, 3)}<b>${w.name}</b><small>${w.desc}</small>${full ? '<em>선택 불가</em>' : ''}</button>`;
  }).join('');

  ui.modes.innerHTML = Object.entries(MODES).map(([k, m]) => `
    <button class="mode${snap.md === k ? ' selected' : ''}" data-act="mode:${k}" ${isHost ? '' : 'disabled'}>
      <b>${m.name}</b><small>${m.desc}</small></button>`).join('');

  ui.lobbyMsg.textContent = snap.lp
    || (isHost ? '준비 완료! 게임을 시작하세요.' : '방장이 게임을 시작하기를 기다리는 중…');
  ui.lobbyMsg.className = snap.lp ? 'warn' : '';
  ui.startBtn.hidden = !isHost;
  ui.startBtn.disabled = !!snap.lp;
  ui.startBtn.dataset.act = 'start';
}

function updateStage(snap, myId) {
  const me = snap.p.find((p) => p.id === myId);
  const key = JSON.stringify([snap.p.map((p) => [p.id, p.rwd, p.evd]), me?.rw, me?.rwd, me?.ev, me?.evd, snap.tt, snap.si]);
  if (key === overlayCache.stage) return;
  overlayCache.stage = key;
  ui.stageTitle.textContent = `${stageLabel(snap.si)} 클리어 → ${stageLabel(snap.si + 1)}`;
  ui.stageSub.textContent = `스테이지 보상을 골라 주세요 · ${snap.tt}초 후 자동 선택`;
  ui.stageSlots.innerHTML = slotHtml(snap, (p) => `<span class="pready">${p.rwd && p.evd ? '✔ 선택 완료' : '고르는 중…'}</span>`);
  const rewardHtml = me?.rwd
    ? '<p class="sub">보상 선택 완료!</p>'
    : `<div class="reward-row">${(me?.rw || []).map((k, i) => {
      const info = offerInfo(k);
      return `<button class="reward" style="--c:${info.color}" data-act="reward${i + 1}">
        <span class="rkey">${i + 1}</span><b>${info.name}</b><small>${info.desc}</small></button>`;
    }).join('')}</div>`;
  const evoHtml = me?.ev && !me.evd
    ? `<h3 class="evo-title">무기 전직 (선택 안 해도 돼요)</h3><div class="reward-row">${me.ev.map((k, i) => {
      const info = offerInfo(`evo:${k}`);
      return `<button class="reward evo" style="--c:${info.color}" data-act="evo${i + 1}">
        ${weaponIconHtml(k, 3)}<b>${info.name}</b><small>${info.desc}</small></button>`;
    }).join('')}<button class="reward skip" data-act="evoskip"><b>전직 안 함</b><small>지금 무기 그대로</small></button></div>`
    : '';
  ui.rewards.innerHTML = rewardHtml + evoHtml + (me?.rwd && me?.evd ? '<p class="sub">다른 팀원을 기다리는 중…</p>' : '');
}

function updateOverlays(snap, myId) {
  session.lastPhase = snap.ph;
  ui.lobby.hidden = snap.ph !== 'lobby';
  ui.stage.hidden = snap.ph !== 'transition';
  if (snap.ph === 'lobby') updateLobby(snap, myId);
  else overlayCache.lobby = '';
  if (snap.ph === 'transition') updateStage(snap, myId);
  else overlayCache.stage = '';
}

// ---------- 프레임 ----------
function hostFrame(s, now) {
  const dt = Math.min((now - s.last) / 1000, 0.1);
  s.last = now;
  if (!(s.solo && s.paused)) {
    s.acc += dt;
    s.inputs[s.myId] = readInput(s.state.players[s.myId]);
    while (s.acc >= STEP) {
      step(s.state, s.inputs, STEP);
      s.acc -= STEP;
    }
  }
  if (s.net && (s.mapDirty || s.sentMapId !== s.state.map.id)) {
    s.net.broadcast({ t: 'map', m: packMap(s.state.map) });
    s.sentMapId = s.state.map.id;
    s.mapDirty = false;
  }
  const snap = snapshot(s.state);
  if (s.net && now - s.lastSend >= SEND_STATE_MS) {
    s.net.broadcast({ t: 's', s: snap });
    s.lastSend = now;
  }
  cam = renderer.render(snap, s.state.map, s.myId, mouse);
  updateOverlays(snap, s.myId);
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
      if (a.s.mid !== b.s.mid) return b.s; // 맵이 바뀐 순간엔 보간하지 않음
      const t = (rt - a.t) / (b.t - a.t || 1);
      return { ...b.s, p: lerpList(a.s.p, b.s.p, t), e: lerpList(a.s.e, b.s.e, t) };
    }
  }
  return rt < buffer[0].t ? buffer[0].s : buffer[buffer.length - 1].s;
}

function clientFrame(s, now) {
  const latest = s.buffer[s.buffer.length - 1]?.s;
  const snap = interpolated(s.buffer, now);
  const me = snap?.p.find((p) => p.id === s.myId);
  if (now - s.lastSend >= SEND_INPUT_MS) {
    s.net.send({ t: 'in', i: readInput(me) });
    s.lastSend = now;
  }
  if (!snap || !latest || !s.map || s.map.id !== snap.mid) {
    renderer.message('맵을 받는 중…');
    return;
  }
  // 카드·골드·단계는 최신 상태로 (보간 X)
  const view = {
    ...snap, g: latest.g, ph: latest.ph, lp: latest.lp, md: latest.md, tt: latest.tt,
    p: snap.p.map((p) => {
      const q = latest.p.find((o) => o.id === p.id) || p;
      return {
        ...p, of: q.of, oq: q.oq, rw: q.rw, rwd: q.rwd, ev: q.ev, evd: q.evd, wp: q.wp, xp: q.xp, lv: q.lv, xn: q.xn,
        ws: q.ws, sl: q.sl, sw: q.sw,
      };
    }),
  };
  cam = renderer.render(view, s.map, s.myId, mouse);
  updateOverlays(view, s.myId);
}

function loop(now) {
  if (session?.mode === 'host') hostFrame(session, now);
  else if (session?.mode === 'client') clientFrame(session, now);
  else renderer.message('던전 슈터');
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
