// 로비 스킬 트리 화면 (이 브라우저의 저장 데이터만 다룸, 게임 계산과는 별개)
import { ELEMENTS } from './data.js';
import {
  TREE, NODE, ACTIVES, ACTIVE_SLOTS, PASSIVE_SLOTS, MAX_BUILD_SLOTS, SLOT_PRICES, RESET_COST,
  canUnlock, equipable, isActive, writeSave,
} from './tree.js';

const GENERAL_ICONS = { g_hp: '♥', g_dmg: '⚔', g_speed: '»', g_xp: '✦', g_ess: '◆', g_cd: '◷' };
const KIND_LABEL = { start: '시작', general: '일반 스탯', root: '속성 각인', active: '액티브 스킬', perk: '패시브 특성', mastery: '속성 숙련', stat: '바깥 가지 스탯', crown: '왕관 노드' };
const R = { start: 22, general: 14, root: 17, active: 19, perk: 17, mastery: 15, stat: 13, crown: 20 };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function icon(n) {
  if (n.kind === 'start') return '◎';
  if (n.kind === 'general') return GENERAL_ICONS[n.id] || '•';
  if (n.kind === 'root') return ELEMENTS[n.el].name.slice(0, 1);
  if (n.kind === 'active') return '✸';
  if (n.kind === 'perk') return '◈';
  if (n.kind === 'crown') return '♛';
  if (n.kind === 'stat') return { castle: '▣', combat: '⚔', army: '⚑', mana: '✦', loot: '●', survive: '♥' }[n.branch] || '•';
  return '▲';
}

// 그 종류(액티브/패시브) 칸에 자리가 있는지
function hasRoom(s, id) {
  const act = isActive(id);
  return s.eq.filter((x) => isActive(x) === act).length < (act ? ACTIVE_SLOTS : PASSIVE_SLOTS);
}

export function createTreeUI(root, { getSave, onChange }) {
  let selected = 'start';
  let message = '';
  // 거미줄 트리 보기: 드래그로 이동, 휠·버튼으로 확대
  const view = { x: 0, y: 0, s: 1 };

  const slot = () => getSave().slots[getSave().active];
  const editable = () => !slot().saved;

  function commit(msg = '') {
    message = msg;
    writeSave(getSave());
    onChange();
    draw();
  }

  function nodeColor(n, unlocked) {
    if (n.kind === 'start') return '#ede7f6';
    if (!unlocked) return n.kind === 'crown' ? '#4a2a2a' : '#3a3556';
    return n.el ? ELEMENTS[n.el].color : n.color || '#e0e0e0';
  }

  function svg() {
    const save = getSave();
    const has = (id) => id === 'start' || save.unlocked.includes(id);
    const eq = slot().eq;
    let lines = '', nodes = '';
    for (const n of TREE) {
      for (const l of n.links) {
        const m = NODE[l];
        const on = has(n.id) && has(l);
        const half = has(n.id) || has(l);
        lines += `<line x1="${m.x}" y1="${m.y}" x2="${n.x}" y2="${n.y}" stroke="${on ? (n.el ? ELEMENTS[n.el].color : n.color || '#bdb6d8') : half ? '#6a6390' : '#3a3556'}" stroke-width="${on ? 3 : 2}" ${on ? '' : 'stroke-dasharray="5 4"'}/>`;
      }
    }
    for (const n of TREE) {
      const un = has(n.id);
      const can = !un && canUnlock(save.unlocked, n.id);
      const r = R[n.kind];
      const isEq = eq.includes(n.id);
      const isEl = n.kind === 'root' && slot().el === n.el;
      const ring = n.id === selected ? '#ffffff' : isEq || isEl ? '#ffd54f' : can ? '#bdb6d8' : 'none';
      nodes += `<g class="tnode${can ? ' can' : ''}" data-node="${n.id}" tabindex="0" role="button" aria-label="${esc(n.name)}">
        <circle cx="${n.x}" cy="${n.y}" r="${r + 4}" fill="none" stroke="${ring}" stroke-width="${isEq || n.id === selected ? 3 : 2}" ${can && n.id !== selected ? 'stroke-dasharray="4 3"' : ''}/>
        <circle cx="${n.x}" cy="${n.y}" r="${r}" fill="${nodeColor(n, un)}" stroke="#fff" stroke-width="2"/>
        <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" font-size="${n.kind === 'start' ? 18 : 13}" font-weight="700" fill="${un ? '#1b1a2e' : '#8f89aa'}">${icon(n)}</text>
      </g>`;
    }
    const size = 960 / view.s;
    return `<div class="tree-wrap"><svg class="tree-svg" viewBox="${view.x - size / 2} ${view.y - size / 2} ${size} ${size}" aria-label="스킬 트리">${lines}${nodes}</svg>
      <div class="tzoom"><button data-tree="zin">＋</button><button data-tree="zout">－</button><button data-tree="zreset">⟲</button><small>드래그로 이동 · 휠로 확대</small></div></div>`;
  }

  function infoPanel() {
    const save = getSave();
    const n = NODE[selected];
    const un = n.id === 'start' || save.unlocked.includes(n.id);
    const can = canUnlock(save.unlocked, n.id);
    const s = slot();
    let actions = '';
    if (!un) {
      const crown = n.kind === 'crown';
      const enough = crown ? save.crowns >= n.crown : save.essence >= n.cost;
      actions = can
        ? `<button data-tree="unlock" ${enough ? '' : 'disabled'}>해금 ${crown ? `♛${n.crown}` : `◆${n.cost}`}</button>`
        : '<p class="hint">이어진 노드 중 하나를 먼저 해금하세요</p>';
    } else if (equipable(n.id)) {
      const on = s.eq.includes(n.id);
      actions = editable()
        ? `<button data-tree="equip">${on ? '장착 해제' : '장착'}</button>`
        : '<p class="hint">저장된 빌드예요. 고치려면 초기화하세요</p>';
    } else if (n.kind === 'root') {
      actions = editable()
        ? `<button data-tree="element">${s.el === n.el ? '캐릭터 속성 해제' : '캐릭터 속성으로 설정'}</button>`
        : '';
    }
    const extra = n.kind === 'active' ? `<small>쿨타임 ${ACTIVES[n.skill].cd}초</small>` : '';
    return `<div class="tinfo">
      <span class="tkind" style="color:${n.el ? ELEMENTS[n.el].color : n.kind === 'crown' ? '#ff8a65' : n.color || '#bdb6d8'}">${KIND_LABEL[n.kind]}</span>
      <b>${esc(n.name)}</b><p>${esc(n.desc)}</p>${extra}
      <div class="tactions">${un && n.kind !== 'start' ? '<span class="owned">해금됨</span>' : ''}${actions}</div>
    </div>`;
  }

  function buildPanel() {
    const save = getSave();
    const tabs = Array.from({ length: MAX_BUILD_SLOTS }, (_, i) => {
      if (i >= save.owned) {
        const buyable = i === save.owned;
        return `<button class="btab locked" data-tree="buy" ${buyable && save.essence >= SLOT_PRICES[i] ? '' : 'disabled'}>🔒 ◆${SLOT_PRICES[i]}</button>`;
      }
      const sl = save.slots[i];
      const name = sl.el ? `${ELEMENTS[sl.el].name}` : '빌드';
      return `<button class="btab${i === save.active ? ' on' : ''}" data-tree="tab" data-i="${i}">${i + 1}. ${name}${sl.saved ? '' : '*'}</button>`;
    }).join('');
    const s = slot();
    const box = (n, label, kind) => `<div class="eqslot${kind === 'p' ? ' pas' : ''}" style="--c:${n ? ELEMENTS[n.el].color : '#3a3556'}"><span>${label}</span>${n ? `<b>${esc(n.name)}</b>` : '<small>비어 있음</small>'}</div>`;
    const acts = s.eq.filter(isActive), pas = s.eq.filter((id) => !isActive(id));
    const slots = `<div class="eqgroup"><small>액티브 (1~3 키)</small><div class="eqrow">${Array.from({ length: ACTIVE_SLOTS }, (_, i) => box(NODE[acts[i]], i + 1, 'a')).join('')}</div></div>
      <div class="eqgroup"><small>패시브 (항상 켜짐)</small><div class="eqrow">${Array.from({ length: PASSIVE_SLOTS }, (_, i) => box(NODE[pas[i]], 'P', 'p')).join('')}</div></div>`;
    const el = s.el ? ELEMENTS[s.el] : null;
    const saveBtns = s.saved
      ? `<button data-tree="reset" ${save.essence < RESET_COST ? 'disabled' : ''}>초기화 ◆${RESET_COST}</button>`
      : '<button data-tree="save" class="primary">빌드 저장·잠금 (무료)</button>';
    return `<div class="bpanel">
      <div class="btabs">${tabs}</div>
      <div class="bel">캐릭터 속성: <b style="color:${el ? el.color : '#9e9e9e'}">${el ? el.name : '없음'}</b>
        <span class="bstate">${s.saved ? '✔ 저장됨(잠금) · 이 빌드로 출발' : '이 빌드로 출발 · 저장하면 잠겨요'}</span></div>
      <div class="eqslots">${slots}</div>
      <div class="bbtns">${saveBtns}</div>
    </div>`;
  }

  function draw() {
    const save = getSave();
    root.innerHTML = `
      <div class="tree-head">
        <h2>스킬 트리</h2>
        <span class="ess">◆ ${save.essence} 정수 · <b style="color:#ffd54f">♛ ${save.crowns}</b> 왕관</span>
        <button data-tree="close" class="tclose">닫기 (K / Esc)</button>
      </div>
      <div class="tree-body">
        ${svg()}
        <aside>${buildPanel()}${infoPanel()}<p class="tmsg" role="status">${esc(message)}</p></aside>
      </div>`;
  }

  root.addEventListener('click', (e) => {
    const nodeEl = e.target.closest('[data-node]');
    if (nodeEl) { selected = nodeEl.dataset.node; message = ''; draw(); return; }
    const b = e.target.closest('[data-tree]');
    if (!b || b.disabled) return;
    const save = getSave();
    const s = slot();
    const n = NODE[selected];
    switch (b.dataset.tree) {
      case 'close': api.close(); break;
      case 'zin': view.s = Math.min(2.5, view.s * 1.25); draw(); break;
      case 'zout': view.s = Math.max(0.6, view.s / 1.25); draw(); break;
      case 'zreset': Object.assign(view, { x: 0, y: 0, s: 1 }); draw(); break;
      case 'unlock':
        if (canUnlock(save.unlocked, n.id) && (n.kind === 'crown' ? save.crowns >= n.crown : save.essence >= n.cost)) {
          if (n.kind === 'crown') save.crowns -= n.crown; else save.essence -= n.cost;
          save.unlocked.push(n.id);
          // 해금하면 바로 쓰도록: 속성 각인 → 캐릭터 속성, 스킬 → 빈 장착 칸
          let note = '';
          if (editable() && n.kind === 'root' && !s.el) { s.el = n.el; note = ' 캐릭터 속성이 되었어요'; }
          if (editable() && equipable(n.id) && hasRoom(s, n.id) && !s.eq.includes(n.id)) { s.eq.push(n.id); note = ` ${isActive(n.id) ? '액티브' : '패시브'} 칸에 장착했어요`; }
          commit(`${n.name} 해금!${note}`);
        }
        break;
      case 'equip':
        if (!editable()) break;
        if (s.eq.includes(n.id)) s.eq = s.eq.filter((id) => id !== n.id);
        else if (hasRoom(s, n.id)) s.eq.push(n.id);
        else { message = isActive(n.id) ? `액티브 칸은 ${ACTIVE_SLOTS}개까지예요. 하나를 먼저 해제하세요` : `패시브 칸은 ${PASSIVE_SLOTS}개까지예요. 하나를 먼저 해제하세요`; draw(); break; }
        commit();
        break;
      case 'element':
        if (!editable()) break;
        s.el = s.el === n.el ? null : n.el;
        commit();
        break;
      case 'save':
        s.saved = true;
        commit('빌드를 저장했어요. 이 빌드로 출발합니다');
        break;
      case 'reset':
        if (save.essence >= RESET_COST) {
          save.essence -= RESET_COST;
          s.saved = false;
          commit('초기화했어요. 고친 다음 다시 저장하세요');
        }
        break;
      case 'buy': {
        const price = SLOT_PRICES[save.owned];
        if (save.owned < MAX_BUILD_SLOTS && save.essence >= price) {
          save.essence -= price;
          save.active = save.owned;
          save.owned++;
          commit('빌드 칸을 샀어요');
        }
        break;
      }
      case 'tab':
        save.active = Number(b.dataset.i);
        commit();
        break;
      default:
    }
  });
  // 드래그로 트리 이동 (노드를 누르면 선택, 빈 곳을 끌면 이동)
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const svgEl = e.target.closest('.tree-svg');
    if (!svgEl || e.target.closest('[data-node]')) return;
    drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, w: svgEl.getBoundingClientRect().width, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 960 / view.s / drag.w;
    view.x = drag.vx - (e.clientX - drag.sx) * k;
    view.y = drag.vy - (e.clientY - drag.sy) * k;
    drag.moved = true;
    const svgEl = root.querySelector('.tree-svg');
    const size = 960 / view.s;
    svgEl?.setAttribute('viewBox', `${view.x - size / 2} ${view.y - size / 2} ${size} ${size}`);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  root.addEventListener('wheel', (e) => {
    if (!e.target.closest('.tree-svg')) return;
    e.preventDefault();
    view.s = Math.max(0.6, Math.min(2.5, view.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    const svgEl = root.querySelector('.tree-svg');
    const size = 960 / view.s;
    svgEl?.setAttribute('viewBox', `${view.x - size / 2} ${view.y - size / 2} ${size} ${size}`);
  }, { passive: false });
  root.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.node) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  const api = {
    isOpen: () => !root.hidden,
    open() { root.hidden = false; draw(); },
    close() { root.hidden = true; },
    refresh() { if (!root.hidden) draw(); },
  };
  return api;
}
