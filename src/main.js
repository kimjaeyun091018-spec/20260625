import { VIEW_W, VIEW_H, MAX_PLAYERS, WEAPONS, ELEMENTS, CHARACTERS, TIER_NAME, stageLabel, offerInfo, elColor, weaponInfo } from './data.js';
import {
  createState, addPlayer, removePlayer, step, snapshot, sanitizeInput, sanitizeName, setBuild,
} from './game.js';
import { packMap, unpackMap } from './maps.js';
import { makeRoomCode, hostRoom, joinRoom, describeError } from './net.js';
import { createRenderer, weaponIconHtml, tintedPlayer, gearSheet } from './render.js';
import { SKINS } from './data.js';
import { loadSave, writeSave, currentBuild, setSaveAccount, NODE } from './tree.js';
import { createTreeUI } from './treeui.js';
import { settings, createSettingsUI, createWardrobeUI, createAccountUI, createArmyUI, createSupplyUI, currentAccount } from './panels.js';
import { createGuildUI } from './guildui.js';
import { setGuildAccount } from './guild.js';
import { UNITS } from './data.js';

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
  title: $('title'),
  menu: $('menu'), name: $('name'), solo: $('soloBtn'), host: $('hostBtn'), code: $('code'), join: $('joinBtn'),
  status: $('status'), roomInfo: $('roomInfo'),
  pause: $('pause'), pauseNote: $('pauseNote'), resume: $('resumeBtn'), quit: $('quitBtn'),
  stage: $('stage'), stageTitle: $('stageTitle'), stageSub: $('stageSub'), stageSlots: $('stageSlots'), rewards: $('rewardCards'),
  account: $('accountBtn'), accountLabel: $('accountLabel'),
};

// ---------- 저장 데이터 (정수, 스킬 트리, 빌드, 스킨) ----------
setSaveAccount(currentAccount());
setGuildAccount(currentAccount());
let save = loadSave();
const tree = createTreeUI($('tree'), {
  getSave: () => save,
  onChange: () => sendBuild(),
});
const settingsUI = createSettingsUI($('settings'));
const wardrobe = createWardrobeUI($('wardrobe'), {
  getSave: () => save,
  onChange: () => { writeSave(save); sendBuild(); },
  preview: skinPreview,
});
const account = createAccountUI($('account'), {
  getSave: () => save,
  onLogin(id) {
    setSaveAccount(id);
    setGuildAccount(id);
    save = loadSave();
    guildUI.quietRefresh();
    if (id && !ui.name.value) ui.name.value = id.slice(0, 10);
    updateAccountLabel();
    sendBuild();
  },
  onImport(data) {
    save = loadSave(data);
    writeSave(save);
    sendBuild();
  },
});
const army = createArmyUI($('army'), {
  getSave: () => save,
  onChange: () => { writeSave(save); sendBuild(); },
  preview: unitPreview,
});
const guildUI = createGuildUI($('guild'), {
  getSave: () => save,
  getName: () => playerName(),
  onChange: () => sendBuild(),
});
guildUI.quietRefresh();
$('guildBtn').addEventListener('click', () => guildUI.open());
const supplyUI = createSupplyUI($('supply'), { getSave: () => save, onChange: () => { writeSave(save); sendBuild(); } });
const overlays = [tree, wardrobe, settingsUI, account, army, guildUI, supplyUI];
const anyOverlay = () => overlays.some((o) => o.isOpen());

function updateAccountLabel() {
  const id = currentAccount();
  ui.accountLabel.textContent = id ? `${id} 계정` : '게스트';
  ui.account.textContent = id ? '계정 · 저장 코드' : '로그인 / 회원가입';
}
updateAccountLabel();
ui.account.addEventListener('click', () => account.open());
for (const b of document.querySelectorAll('[data-open-settings]')) b.addEventListener('click', () => settingsUI.open());

// 옷장 미리보기 그림 (스킨마다 한 번만 만듦)
const previewCache = {};
function skinPreview(skin) {
  if (previewCache[skin]) return previewCache[skin];
  try {
    const sheet = tintedPlayer('#ffffff', skin);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet, 0, 0, 32, 32, 0, 0, 64, 64);
    const gi = SKINS[skin]?.gear;
    if (gi !== undefined) {
      const gear = gearSheet();
      if (!gear) return c.toDataURL(); // 아직 로딩 중: 저장하지 않고 다음에 다시
      g.drawImage(gear, gi * 32, 0, 32, 32, 0, 0, 64, 64);
    }
    previewCache[skin] = c.toDataURL();
  } catch { return ''; }
  return previewCache[skin];
}

// 병영 미리보기: 유닛 색으로 칠한 캐릭터
function unitPreview(k) {
  const key = `unit:${k}`;
  if (previewCache[key]) return previewCache[key];
  try {
    const U = UNITS[k];
    const sheet = tintedPlayer('#ffffff', { body: U.body, eye: U.eye });
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(sheet, 0, 0, 32, 32, 0, 0, 64, 64);
    previewCache[key] = c.toDataURL();
  } catch { return ''; }
  return previewCache[key];
}

function sendBuild() {
  if (!session) return;
  const b = currentBuild(save);
  if (session.mode === 'host') setBuild(session.state, session.myId, b);
  else session.net?.send({ t: 'build', b });
}

// 이번 판에 번 정수·왕관을 저장 (판이 끝났을 때, 또는 중간에 나갈 때 한 번만)
function bankEssence(rid, amount, crowns = 0, spoils = 0) {
  if (!session || session.banked.has(rid) || !(amount > 0 || crowns > 0 || spoils > 0)) return;
  session.banked.add(rid);
  save.essence += Math.floor(amount || 0);
  save.crowns = (save.crowns || 0) + Math.floor(crowns || 0);
  save.spoils = (save.spoils || 0) + Math.floor(spoils || 0);
  writeSave(save);
}

function buildSummary() {
  const b = currentBuild(save);
  const el = b.el ? ELEMENTS[b.el] : null;
  const names = b.eq.map((id) => NODE[id]?.name).filter(Boolean).join(' · ') || '장착 없음 (제단에서 스킬 트리)';
  return { title: `빌드 ${save.active + 1}: ${el ? `${el.name} 속성` : '속성 없음'}`, sub: names, color: el ? el.color : '#fff' };
}

// ---------- 타이틀 화면 ----------
let onTitle = true;
function leaveTitle() {
  if (!onTitle) return;
  onTitle = false;
  ui.title.hidden = true;
  ui.menu.hidden = false;
  ui.name.focus();
}
ui.title.addEventListener('pointerdown', leaveTitle);
ui.title.addEventListener('click', leaveTitle);
window.addEventListener('keydown', (e) => { if (onTitle && !e.repeat) { e.preventDefault(); leaveTitle(); } }, { capture: true });

// ---------- 입력 (키보드 + 마우스) ----------
const HOLD_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
};
const ACTION_KEYS = {
  KeyE: 'fence', KeyR: 'turret', KeyF: 'demolish', KeyG: 'ready', KeyQ: 'ult', Tab: 'swap',
  KeyV: 'skill', KeyZ: 'pick1', KeyX: 'pick2', KeyC: 'pick3',
};
const NUMBER_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 };
const SUMMON_KEYS = { Digit4: 1, Digit5: 2, Digit6: 3, Digit7: 4, Numpad4: 1, Numpad5: 2, Numpad6: 3, Numpad7: 4 };
const keys = new Set();
// sx/sy: 화면 좌표, x/y: 맵(월드) 좌표
const mouse = { sx: VIEW_W / 2, sy: VIEW_H / 2, x: 0, y: 0, down: false };
let cam = { x: 0, y: 0, z: 1 };
const actionQueue = [];
let actionSeq = 0;

const pushAction = (act) => { if (session && !session.paused && !anyOverlay()) actionQueue.push(act); };

function nearStation(key, range) {
  const me = session?.lastMe, L = session?.lastMap?.lobby;
  const o = L?.[key];
  return !!(me && o && Math.hypot(me.x - o.x, me.y - o.y) < range);
}

window.addEventListener('keydown', (e) => {
  if (onTitle) return;
  if (anyOverlay()) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.code === 'Escape' || (e.code === 'KeyK' && tree.isOpen())) { overlays.forEach((o) => o.close()); e.preventDefault(); }
    return;
  }
  if (!session) return;
  if (e.code === 'Escape') { setPaused(!session.paused); e.preventDefault(); return; }
  if (session.paused || e.target instanceof HTMLInputElement) return;
  const phase = session.lastPhase;
  const hold = HOLD_KEYS[e.code];
  if (hold) { keys.add(hold); e.preventDefault(); }
  if (e.repeat) return;
  if (phase === 'lobby' && (e.code === 'KeyK' || (e.code === 'KeyE' && nearStation('altar', 60)))) {
    keys.clear();
    tree.open();
    e.preventDefault();
    return;
  }
  if (phase === 'lobby' && e.code === 'KeyE' && nearStation('wardrobe', 60)) {
    keys.clear();
    wardrobe.open();
    e.preventDefault();
    return;
  }
  if (phase === 'lobby' && e.code === 'KeyE' && nearStation('barracks', 60)) {
    keys.clear();
    army.open();
    e.preventDefault();
    return;
  }
  if (phase === 'lobby' && e.code === 'KeyE' && nearStation('supply', 56)) {
    keys.clear();
    supplyUI.open();
    e.preventDefault();
    return;
  }
  if (phase === 'lobby' && e.code === 'KeyE' && nearStation('guild', 60)) {
    keys.clear();
    guildUI.open();
    e.preventDefault();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    if (settings.autoAim) keys.add('autofire');
    e.preventDefault();
    return;
  }
  // 성 지키기: 4~7 군단 소환, T 성 강화
  const sm = SUMMON_KEYS[e.code];
  if (sm && phase === 'playing' && session.lastSnap?.ca) { pushAction(`sum${sm}`); e.preventDefault(); return; }
  if (e.code === 'KeyT' && phase === 'playing' && session.lastSnap?.ca) { pushAction('castle'); e.preventDefault(); return; }
  const n = NUMBER_KEYS[e.code];
  if (n) {
    if (phase === 'playing' || phase === 'lobby') pushAction(`cast${n}`);
    else if (phase === 'transition' && n <= 3) pushAction(`reward${n}`);
    e.preventDefault();
    return;
  }
  const act = ACTION_KEYS[e.code];
  if (act) { pushAction(act); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = HOLD_KEYS[e.code];
  if (k) keys.delete(k);
  if (e.code === 'Enter' || e.code === 'NumpadEnter') keys.delete('autofire');
});
window.addEventListener('blur', () => {
  keys.clear();
  mouse.down = false;
  if (session?.solo && !anyOverlay()) setPaused(true); // 혼자 하기 중 다른 창/앱으로 가면 자동으로 멈춤
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

// 보상 화면의 버튼은 누르는 순간(pointerdown) 바로 행동을 보냅니다.
// (click은 누르는 동안 화면이 다시 그려지면 사라질 수 있어서 쓰지 않음)
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && e.button === 0) { e.preventDefault(); pushAction(el.dataset.act); el.classList.add('pressed'); }
});
document.addEventListener('keydown', (e) => {
  const el = e.target.closest?.('[data-act]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pushAction(el.dataset.act); }
});

// 오토에임: 가장 가까운 적 (없으면 마지막으로 움직인 방향)
let lastMoveAim = 0;
function autoTarget(me) {
  const enemies = session?.lastSnap?.e || [];
  let best = null, bd = 520 * 520;
  for (const e of enemies) {
    const d = (e.x - me.x) ** 2 + (e.y - me.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function readInput(me) {
  mouse.x = mouse.sx / (cam.z || 1) + cam.x;
  mouse.y = mouse.sy / (cam.z || 1) + cam.y;
  if (session?.paused || anyOverlay()) return { aim: me?.a ?? me?.angle ?? 0, seq: actionSeq, pz: !!session?.paused };
  const act = actionQueue.shift() || null;
  if (act) actionSeq++;
  const mx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), my = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
  if (mx || my) lastMoveAim = Math.atan2(my, mx);
  let aim = me ? Math.atan2(mouse.y - me.y, mouse.x - me.x) : 0;
  let bx = Math.round(mouse.x), by = Math.round(mouse.y);
  if (settings.autoAim && me) {
    const t = autoTarget(me);
    if (t) { aim = Math.atan2(t.y - me.y, t.x - me.x); bx = Math.round(t.x); by = Math.round(t.y); }
    else if (keys.has('autofire') || !mouse.down) { aim = lastMoveAim; bx = Math.round(me.x + Math.cos(aim) * 200); by = Math.round(me.y + Math.sin(aim) * 200); }
  }
  return {
    up: keys.has('up'), down: keys.has('down'), left: keys.has('left'), right: keys.has('right'),
    dash: keys.has('dash'), fire: mouse.down || keys.has('autofire'),
    aim, act, seq: actionSeq, bx, by,
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
  sendBuild();
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
  // 게임 도중 나가도 그때까지 번 정수는 저장
  const snap = session.lastSnap;
  if (snap && snap.ph !== 'lobby' && session.lastMe) bankEssence(snap.rid, session.lastMe.es, session.lastMe.cw, session.lastMe.sp);
  session.net?.close();
  session = null;
  overlays.forEach((o) => o.close());
  for (const el of [ui.pause, ui.stage, ui.roomInfo]) el.hidden = true;
  ui.menu.hidden = false;
  overlayCache.stage = '';
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
          onBuild(id, b) { setBuild(state, id, b); },
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
    mode: 'host', solo, paused: false, myId, state, inputs, net, code: net?.code, banked: new Set(),
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
    map: null, code, lastPhase: 'lobby', banked: new Set(),
  };
  try {
    s.net = await joinRoom(code, playerName(), {
      onWelcome(id) { s.myId = id; },
      onState(snap) {
        s.buffer.push({ t: performance.now(), s: unpackSnap(snap) });
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

window.addEventListener('pagehide', () => {
  const snap = session?.lastSnap;
  if (snap && snap.ph !== 'lobby' && session.lastMe) bankEssence(snap.rid, session.lastMe.es, session.lastMe.cw, session.lastMe.sp);
  session?.net?.close();
});
ui.solo.addEventListener('click', () => startHost(true));
ui.host.addEventListener('click', () => startHost(false));
ui.join.addEventListener('click', startClient);
ui.code.addEventListener('keydown', (e) => { if (e.key === 'Enter') startClient(); });
try { ui.name.value = localStorage.getItem('sk-name') || ''; } catch { /* 저장소 사용 불가 */ }
ui.name.addEventListener('change', () => {
  try { localStorage.setItem('sk-name', ui.name.value); } catch { /* 무시 */ }
});

// ---------- 스테이지 보상 화면 (HTML) ----------
const overlayCache = { stage: '' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function slotHtml(snap, extra) {
  let html = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = snap.p[i];
    if (!p) { html += `<div class="slot empty"><b>${i + 1}P</b><span>비어 있음</span></div>`; continue; }
    const w = p.ws?.[p.sl];
    const C = CHARACTERS[p.cr];
    html += `<div class="slot" style="--c:${p.c}"><b>${i + 1}P</b>
      <span class="pname">${esc(p.n)}${p.id === snap.hid ? ' 👑' : ''}${C ? ` · ${C.name}` : ''}</span>
      <span class="pweap" style="color:${elColor(w?.el)}">${w ? `${weaponIconHtml(w.k, 1.5)} ${weaponName(w)}` : ''}</span>${extra ? extra(p) : ''}</div>`;
  }
  return html;
}

const weaponName = (w) => `${ELEMENTS[w.el] ? `${ELEMENTS[w.el].name}의 ` : ''}${WEAPONS[w.k].name}`;

function updateStage(snap, myId) {
  const me = snap.p.find((p) => p.id === myId);
  // 남은 시간 글자만 매초 바꾸고, 버튼은 선택이 바뀔 때만 다시 만듭니다.
  ui.stageSub.textContent = `스테이지 보상을 골라 주세요 (종류마다 한 번만) · ${snap.tt}초 후 자동 선택`;
  const key = JSON.stringify([snap.p.map((p) => [p.id, p.rwd, p.evd]), me?.rw, me?.rwd, me?.ev, me?.evd, snap.si]);
  if (key === overlayCache.stage) return;
  overlayCache.stage = key;
  ui.stageTitle.textContent = `${stageLabel(snap.si)} 클리어 → ${stageLabel(snap.si + 1)}`;
  ui.stageSlots.innerHTML = slotHtml(snap, (p) => `<span class="pready">${p.rwd && p.evd ? '✔ 선택 완료' : '고르는 중…'}</span>`);
  const rewardHtml = me?.rwd
    ? '<p class="sub">보상 선택 완료!</p>'
    : `<div class="reward-row">${(me?.rw || []).map((k, i) => {
      const info = offerInfo(k);
      return `<button class="reward" style="--c:${info.color}" data-act="reward${i + 1}">
        <span class="rkey">${i + 1}</span><b>${info.name}</b><small>${info.desc}</small></button>`;
    }).join('')}</div>`;
  const evoHtml = me?.ev && !me.evd
    ? `<h3 class="evo-title">무기 진화: ${esc(weaponName(me.ws[me.sl]))} → (속성은 그대로, 선택 안 해도 돼요)</h3><div class="reward-row">${me.ev.map((k, i) => {
      const info = offerInfo(`evo:${k}`);
      const wi = weaponInfo(k), W = WEAPONS[k];
      const more = `${TIER_NAME[W.tier]} · 명중 ${wi.acc}% · 마나 ${wi.mana || 0}${W.evo ? ` · 다음: ${W.evo.map((e) => WEAPONS[e].name).join('/')}` : ''}`;
      return `<button class="reward evo" style="--c:${elColor(me.ws[me.sl].el)}" data-act="evo${i + 1}">
        ${weaponIconHtml(k, 3)}<b>${info.name}</b><small>${info.desc}</small><small>${more}</small></button>`;
    }).join('')}<button class="reward skip" data-act="evoskip"><b>진화 안 함</b><small>지금 무기 그대로</small></button></div>`
    : '';
  ui.rewards.innerHTML = rewardHtml + evoHtml + (me?.rwd && me?.evd ? '<p class="sub">다른 팀원을 기다리는 중…</p>' : '');
}

function afterRender(snap, map, myId) {
  const me = snap.p.find((p) => p.id === myId);
  session.lastSnap = snap;
  session.lastMap = map;
  if (me) session.lastMe = me;
  if (session.lastPhase !== snap.ph && snap.ph === 'lobby') { tree.refresh(); sendBuild(); }
  session.lastPhase = snap.ph;
  if (snap.ph === 'over' && me) bankEssence(snap.rid, me.es, me.cw, me.sp);
  // 모험을 시작하면 가져간 보급품은 사라짐
  if (snap.ph === 'playing' && snap.md === 'adv' && session.suppliesRid !== snap.rid) {
    session.suppliesRid = snap.rid;
    if (Object.keys(save.supplies || {}).length) { save.supplies = {}; writeSave(save); }
  }
  if (snap.ph !== 'lobby') { for (const o of [tree, wardrobe, army, supplyUI]) if (o.isOpen()) o.close(); }
  ui.stage.hidden = snap.ph !== 'transition';
  if (snap.ph === 'transition') updateStage(snap, myId);
  else overlayCache.stage = '';
}

const renderExtra = () => ({ essence: save.essence, spoils: save.spoils, crowns: save.crowns, build: buildSummary(), damageNumbers: settings.damageNumbers, zoom: settings.zoom || 1 });

// ---------- 프레임 ----------
function hostFrame(s, now) {
  const dt = Math.min((now - s.last) / 1000, 0.1);
  s.last = now;
  // 혼자 하는 생존 모드에서는 레벨업 카드를 고르는 동안 시간이 멈춤 (탕탕특공대처럼)
  const meP = s.state.players[s.myId];
  const cardHold = s.solo && meP?.offer && s.state.mode === 'camp' && s.state.phase === 'playing';
  if (cardHold && !s.paused) {
    s.inputs[s.myId] = readInput(meP);
    step(s.state, s.inputs, 0); // 카드 선택만 처리
    s.acc = 0;
  } else if (!(s.solo && s.paused)) {
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
    s.net.broadcast({ t: 's', s: packSnap(snap) });
    s.lastSend = now;
  }
  cam = renderer.render(snap, s.state.map, s.myId, mouse, renderExtra());
  afterRender(snap, s.state.map, s.myId);
}

// ---------- 네트워크용 스냅샷 줄이기 (적이 많은 생존 모드 대비) ----------
const E_KEYS = ['id', 'k', 'x', 'y', 'r', 'hp', 'mh', 'h', 's', 'c', 'ch', 'f', 'fu', 'ai', 'w'];
function packSnap(snap) {
  let dn = 0, die = 0;
  const fx = [];
  for (let i = snap.fx.length - 1; i >= 0; i--) {
    const f = snap.fx[i];
    if (f.k === 'dn' && ++dn > 50) continue;
    if (f.k === 'die' && ++die > 30) continue;
    fx.push(f);
  }
  return {
    ...snap,
    e: snap.e.map((e) => E_KEYS.map((k) => (k === 'hp' ? Math.round(e.hp * 10) / 10 : e[k]))),
    fx: fx.reverse(),
  };
}
function unpackSnap(snap) {
  if (!snap?.e?.length || !Array.isArray(snap.e[0])) return snap;
  return { ...snap, e: snap.e.map((a) => Object.fromEntries(E_KEYS.map((k, i) => [k, a[i]]))) };
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
    ...snap, g: latest.g, ph: latest.ph, sh: latest.sh, hz: latest.hz, sv: latest.sv, br: latest.br, xo: latest.xo, ca: latest.ca, un: latest.un, lp: latest.lp, lpt: latest.lpt, md: latest.md, tt: latest.tt, rid: latest.rid,
    p: snap.p.map((p) => {
      const q = latest.p.find((o) => o.id === p.id) || p;
      return {
        ...p, of: q.of, oq: q.oq, at: q.at, rw: q.rw, rwd: q.rwd, ev: q.ev, evd: q.evd, cr: q.cr, xp: q.xp, lv: q.lv, xn: q.xn,
        ws: q.ws, sl: q.sl, sw: q.sw, ld: q.ld, cs: q.cs, es: q.es, mp: q.mp, mm: q.mm, wst: q.wst, sk: q.sk, co: q.co, sh: q.sh, cb: q.cb,
        sp: q.sp, rv: q.rv, pp: q.pp, cw: q.cw, gd: q.gd, uc: q.uc, ucap: q.ucap, ar: q.ar,
      };
    }),
  };
  cam = renderer.render(view, s.map, s.myId, mouse, renderExtra());
  afterRender(view, s.map, s.myId);
}

function loop(now) {
  if (session?.mode === 'host') hostFrame(session, now);
  else if (session?.mode === 'client') clientFrame(session, now);
  else renderer.title(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__gameReady = true; // index.html의 '불러오기 실패' 안내를 끔
