// 설정 · 옷장(스킨) · 계정(로그인, 저장 코드) 화면
import { SKINS, UNITS, UNIT_KEYS, ARMY_SLOTS, UNIT_MAX_LV, unitLevelCost, unitScale, SUPPLIES, SPOIL_TO_ESSENCE } from './data.js';
import { exportSaveCode, importSaveCode } from './tree.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeGet(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장소 사용 불가 */ }
}

// ---------------------------------------------------------------- 설정
const SETTINGS_KEY = 'sk-settings';
export const settings = { autoAim: false, damageNumbers: true, zoom: 1.25, ...safeGet(SETTINGS_KEY, {}) };
export const ZOOMS = [1, 1.25, 1.5];

export function createSettingsUI(root) {
  function draw() {
    root.innerHTML = `
      <h2>설정</h2>
      <label class="toggle"><input type="checkbox" data-set="autoAim" ${settings.autoAim ? 'checked' : ''}>
        <span><b>오토에임 (Enter 공격)</b><small>Enter를 누르고 있으면 가장 가까운 적을 자동으로 조준해서 공격합니다.
        스킬도 가까운 적을 노립니다. 마우스 없이 키보드만으로 플레이할 때 켜세요.</small></span></label>
      <label class="toggle"><input type="checkbox" data-set="damageNumbers" ${settings.damageNumbers ? 'checked' : ''}>
        <span><b>피해 숫자 표시</b><small>적에게 준 피해를 숫자로 보여 줍니다. 치명타는 노란색, 지속 피해는 회색.</small></span></label>
      <div class="toggle"><span><b>화면 확대</b><small>캐릭터와 적을 크게 봅니다. 크게 할수록 한 번에 보이는 범위는 좁아져요.</small>
        <span class="seg">${ZOOMS.map((z) => `<button data-zoom="${z}" class="${settings.zoom === z ? 'on' : ''}">${Math.round(z * 100)}%</button>`).join('')}</span></span></div>
      <p class="help">키보드만으로: 이동 WASD · 공격 Enter(오토에임) · 무기 스킬 V · 궁극기 Q · 스킬 1~3 · 증강 카드 Z/X/C</p>
      <button data-close>닫기</button>`;
  }
  root.addEventListener('change', (e) => {
    const k = e.target.dataset?.set;
    if (!k) return;
    settings[k] = e.target.checked;
    safeSet(SETTINGS_KEY, settings);
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.close(); return; }
    const z = e.target.closest('[data-zoom]');
    if (z) { settings.zoom = Number(z.dataset.zoom); safeSet(SETTINGS_KEY, settings); draw(); }
  });
  const api = {
    isOpen: () => !root.hidden,
    open() { draw(); root.hidden = false; },
    close() { root.hidden = true; },
  };
  return api;
}

// ---------------------------------------------------------------- 옷장
export function createWardrobeUI(root, { getSave, onChange, preview }) {
  let msg = '';
  function draw() {
    const save = getSave();
    const cards = Object.entries(SKINS).map(([k, sk]) => {
      const owned = save.skins.includes(k);
      const on = save.skin === k;
      const btn = on
        ? '<span class="owned">착용 중</span>'
        : owned
          ? `<button data-skin="${k}" data-do="wear">착용</button>`
          : `<button data-skin="${k}" data-do="buy" ${save.essence < sk.price ? 'disabled' : ''}>구매 ◆${sk.price}</button>`;
      return `<div class="skin${on ? ' on' : ''}"><img src="${preview(k)}" alt="" width="64" height="64"><b>${esc(sk.name)}</b>${btn}</div>`;
    }).join('');
    root.innerHTML = `
      <div class="tree-head"><h2>옷장</h2><span class="ess">◆ ${save.essence} 정수</span><button data-close class="tclose">닫기 (Esc)</button></div>
      <p class="sub">스킨은 모습만 바뀝니다. 능력치는 그대로예요.</p>
      <div class="skins">${cards}</div>
      <p class="tmsg">${esc(msg)}</p>`;
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.close(); return; }
    const b = e.target.closest('[data-skin]');
    if (!b || b.disabled) return;
    const save = getSave();
    const k = b.dataset.skin;
    if (b.dataset.do === 'buy' && save.essence >= SKINS[k].price && !save.skins.includes(k)) {
      save.essence -= SKINS[k].price;
      save.skins.push(k);
      save.skin = k;
      msg = `${SKINS[k].name} 스킨을 샀어요!`;
    } else if (b.dataset.do === 'wear') {
      save.skin = k;
      msg = '';
    }
    onChange();
    draw();
  });
  const api = {
    isOpen: () => !root.hidden,
    open() { msg = ''; draw(); root.hidden = false; },
    close() { root.hidden = true; },
  };
  return api;
}

// ---------------------------------------------------------------- 계정
// 이 브라우저 안에서만 쓰는 계정입니다. 비밀번호는 SHA-256으로 바꿔서 저장합니다.
// 다른 기기로 옮길 때는 '저장 코드'를 씁니다. (기기끼리 자동 동기화는 서버가 있어야 해요)
const ACCOUNTS_KEY = 'sk-accounts';
const CURRENT_KEY = 'sk-current-account';

async function hashPw(salt, pw) {
  const data = new TextEncoder().encode(`${salt}:${pw}`);
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  // 보안 연결(https)이 아닐 때만 쓰는 간단한 대체 해시
  let h = 2166136261;
  for (const b of data) h = Math.imul(h ^ b, 16777619);
  return `f${(h >>> 0).toString(16)}`;
}

export function currentAccount() {
  const id = safeGet(CURRENT_KEY, null);
  return id && safeGet(ACCOUNTS_KEY, {})[id] ? id : null;
}

export function createAccountUI(root, { getSave, onLogin, onImport }) {
  let mode = 'login';
  let msg = '';
  let code = '';

  const codeBox = () => `
        <h3>다른 기기로 옮기기 (저장 코드)</h3>
        <p class="help">코드를 만들어 복사한 뒤, 다른 기기의 같은 화면에 붙여 넣고 불러오세요. 불러오면 지금 저장이 바뀝니다.</p>
        <div class="codebox">
          <button data-do="export">저장 코드 만들기</button>
          <textarea id="saveCode" rows="3" placeholder="여기에 저장 코드를 붙여 넣으세요">${esc(code)}</textarea>
          <button data-do="import">붙여 넣은 코드 불러오기</button>
        </div>`;

  function draw() {
    const id = currentAccount();
    if (id) {
      root.innerHTML = `
        <h2>계정</h2>
        <p class="sub"><b>${esc(id)}</b> 계정으로 로그인했어요. 스킬 트리·정수·스킨이 이 계정에 저장됩니다.</p>
        <div class="buttons"><button data-do="logout" class="danger">로그아웃</button><button data-close>닫기</button></div>
        ${codeBox()}
        <p class="tmsg" role="status">${esc(msg)}</p>`;
      return;
    }
    root.innerHTML = `
      <h2>${mode === 'login' ? '로그인' : '회원가입'}</h2>
      <p class="sub">이 기기에서 쓰는 계정이에요. 한 기기를 여러 명이 쓸 때 저장을 나눠 줍니다.</p>
      <form class="login">
        <input id="accId" maxlength="16" placeholder="아이디" autocomplete="username" required>
        <input id="accPw" type="password" maxlength="32" placeholder="비밀번호 (4자 이상)" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
        <button type="submit">${mode === 'login' ? '로그인' : '가입하기'}</button>
      </form>
      <p class="help"><a href="#" data-do="switch">${mode === 'login' ? '계정이 없나요? 회원가입' : '이미 계정이 있나요? 로그인'}</a></p>
      <p class="tmsg" role="status">${esc(msg)}</p>
      ${codeBox()}
      <button data-close>닫기 (게스트로 계속)</button>`;
  }

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = root.querySelector('#accId').value.trim();
    const pw = root.querySelector('#accPw').value;
    if (!/^[\w가-힣]{2,16}$/.test(id)) { msg = '아이디는 2~16자 (한글·영문·숫자·_)'; draw(); return; }
    if (pw.length < 4) { msg = '비밀번호는 4자 이상이에요'; draw(); return; }
    const accounts = safeGet(ACCOUNTS_KEY, {});
    if (mode === 'register') {
      if (accounts[id]) { msg = '이미 있는 아이디예요'; draw(); return; }
      const salt = Math.random().toString(36).slice(2, 10);
      accounts[id] = { salt, hash: await hashPw(salt, pw) };
      safeSet(ACCOUNTS_KEY, accounts);
    } else {
      const a = accounts[id];
      if (!a || a.hash !== await hashPw(a.salt, pw)) { msg = '아이디 또는 비밀번호가 맞지 않아요'; draw(); return; }
    }
    safeSet(CURRENT_KEY, id);
    msg = '';
    onLogin(id);
    draw();
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.close(); return; }
    const b = e.target.closest('[data-do]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.do === 'switch') { mode = mode === 'login' ? 'register' : 'login'; msg = ''; }
    else if (b.dataset.do === 'logout') { safeSet(CURRENT_KEY, null); code = ''; onLogin(null); }
    else if (b.dataset.do === 'export') {
      code = exportSaveCode(getSave());
      msg = '저장 코드를 만들었어요. 복사해서 다른 기기에 붙여 넣으세요.';
      navigator.clipboard?.writeText(code).then(() => { msg = '저장 코드를 클립보드에 복사했어요.'; draw(); }).catch(() => {});
    } else if (b.dataset.do === 'import') {
      const data = importSaveCode(root.querySelector('#saveCode').value);
      if (!data) msg = '저장 코드가 올바르지 않아요. 전부 복사했는지 확인해 주세요.';
      else { onImport(data); msg = '저장 코드를 불러왔어요!'; code = ''; }
    }
    draw();
  });

  const api = {
    isOpen: () => !root.hidden,
    open() { msg = ''; draw(); root.hidden = false; },
    close() { root.hidden = true; },
  };
  return api;
}

// ---------------------------------------------------------------- 해금 연출 (빛줄기 + 큰 그림 + 이름)
export function showReveal(imgSrc, name, sub = '') {
  document.querySelector('.reveal')?.remove();
  const el = document.createElement('div');
  el.className = 'reveal';
  el.innerHTML = `<div class="rays"></div><div class="rbody"><img src="${imgSrc}" alt=""><b>${esc(name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  const close = () => el.remove();
  el.addEventListener('pointerdown', close);
  setTimeout(close, 2600);
  document.getElementById('wrap').appendChild(el);
}

// ---------------------------------------------------------------- 병영 (군단 편성)
// 성키우기처럼: 정수로 유닛 해금·레벨업, 성 지키기에 데려갈 4종 선택 (4~7 키로 소환)
export function createArmyUI(root, { getSave, onChange, preview }) {
  let msg = '';
  function draw() {
    const save = getSave(), A = save.army;
    const giantOk = save.unlocked.includes('c_army');
    const cards = UNIT_KEYS.map((k) => {
      const U = UNITS[k];
      const own = A.unlocked.includes(k) || (k === 'giant' && giantOk);
      const lv = A.lv[k] || 1, sc = unitScale(lv);
      const sel = A.sel.indexOf(k);
      let btn;
      if (!own) {
        btn = U.crown ? '<small class="hint">스킬 트리 왕관 노드 「거인의 맹약」</small>'
          : `<button data-army="unlock" data-k="${k}" ${save.essence < U.unlock ? 'disabled' : ''}>해금 ◆${U.unlock}</button>`;
      } else {
        btn = `<button data-army="sel" data-k="${k}" class="${sel >= 0 ? 'on' : ''}">${sel >= 0 ? `${4 + sel}번 키 ✔` : '데려가기'}</button>
          ${lv < UNIT_MAX_LV ? `<button data-army="up" data-k="${k}" ${save.essence < unitLevelCost(lv) ? 'disabled' : ''}>레벨업 ◆${unitLevelCost(lv)}</button>` : '<small>최대 레벨</small>'}`;
      }
      return `<div class="skin unit${own ? '' : ' locked'}${sel >= 0 ? ' on' : ''}">
        <img src="${preview(k)}" alt="" width="64" height="64">
        <b>${U.name} ${own ? `Lv${lv}` : '🔒'}</b>
        <small>${U.desc}</small>
        <small>체력 ${Math.round(U.hp * sc)} · ${U.heal ? `회복 ${Math.round(U.heal * sc * 10) / 10}` : `피해 ${Math.round(U.dmg * sc * 10) / 10}`} · 소환 ●${U.cost}</small>
        ${btn}</div>`;
    }).join('');
    root.innerHTML = `<div class="tree-head"><h2>병영 · 군단 편성</h2><span class="ess">◆ ${save.essence} 정수</span><button data-army="close" class="tclose">닫기 (Esc)</button></div>
      <p class="sub">성 지키기 모드에서 골드로 소환할 유닛 ${ARMY_SLOTS}종을 고르세요 (게임 중 4·5·6·7 키). 레벨이 높을수록 체력·피해 +15%씩.</p>
      <div class="skins">${cards}</div><p class="tmsg" role="status">${msg}</p>`;
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-army]');
    if (!b || b.disabled) return;
    const save = getSave(), A = save.army, k = b.dataset.k, U = UNITS[k];
    msg = '';
    switch (b.dataset.army) {
      case 'close': api.close(); return;
      case 'unlock':
        if (save.essence >= U.unlock && !A.unlocked.includes(k)) { save.essence -= U.unlock; A.unlocked.push(k); msg = `${U.name} 해금!`; showReveal(preview(k), U.name, '새 군단 유닛 해금!'); }
        break;
      case 'up': {
        const lv = A.lv[k] || 1, cost = unitLevelCost(lv);
        if (lv < UNIT_MAX_LV && save.essence >= cost) { save.essence -= cost; A.lv[k] = lv + 1; msg = `${U.name} Lv${lv + 1}!`; }
        break;
      }
      case 'sel':
        if (A.sel.includes(k)) A.sel = A.sel.filter((x) => x !== k);
        else if (A.sel.length < ARMY_SLOTS) {
          if (k === 'giant' && !A.unlocked.includes(k)) { A.unlocked.push(k); showReveal(preview(k), U.name, '전설 유닛 합류!'); }
          A.sel.push(k);
        }
        else msg = `${ARMY_SLOTS}종까지 데려갈 수 있어요. 하나를 먼저 빼세요`;
        break;
      default:
    }
    onChange();
    draw();
  });
  const api = {
    isOpen: () => !root.hidden,
    open() { draw(); root.hidden = false; },
    close() { root.hidden = true; },
  };
  return api;
}

// ---------------------------------------------------------------- 보급관 (전리품 ✪ 사용처)
// 성 지키기 상자에서 얻은 전리품으로 다음 모험의 보급품을 사거나 정수로 바꿈
export function createSupplyUI(root, { getSave, onChange }) {
  let msg = '';
  function draw() {
    const save = getSave();
    const items = Object.entries(SUPPLIES).map(([k, it]) => {
      const owned = !!save.supplies[k];
      return `<div class="skin supply${owned ? ' on' : ''}"><b>${it.name}</b><small>${it.desc}</small>
        ${owned ? '<small class="owned">✔ 다음 모험에 가져감</small>' : `<button data-sup="buy" data-k="${k}" ${save.spoils < it.price ? 'disabled' : ''}>✪${it.price} 사기</button>`}</div>`;
    }).join('');
    root.innerHTML = `<div class="tree-head"><h2>보급관</h2><span class="ess">✪ ${save.spoils} 전리품 · ◆ ${save.essence} 정수</span><button data-sup="close" class="tclose">닫기 (Esc)</button></div>
      <p class="sub">전리품(✪)은 성 지키기의 상자·정예·승리로 얻어요. 보급품은 <b>다음 모험 모드</b>에서 한 번 쓰이고 사라져요.</p>
      <div class="skins">${items}
        <div class="skin supply"><b>정수로 바꾸기</b><small>✪1 → ◆${SPOIL_TO_ESSENCE} (스킬 트리·병영에 쓰기)</small>
          <button data-sup="ex" data-n="1" ${save.spoils < 1 ? 'disabled' : ''}>✪1 → ◆${SPOIL_TO_ESSENCE}</button>
          <button data-sup="ex" data-n="10" ${save.spoils < 10 ? 'disabled' : ''}>✪10 → ◆${SPOIL_TO_ESSENCE * 10}</button></div>
      </div>
      <p class="hint">길드 회관에서 전리품을 길드에 기부할 수도 있어요 (✪1 = 길드 경험치 10).</p>
      <p class="tmsg" role="status">${msg}</p>`;
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sup]');
    if (!b || b.disabled) return;
    const save = getSave();
    msg = '';
    if (b.dataset.sup === 'close') { api.close(); return; }
    if (b.dataset.sup === 'buy') {
      const k = b.dataset.k, it = SUPPLIES[k];
      if (!save.supplies[k] && save.spoils >= it.price) { save.spoils -= it.price; save.supplies[k] = true; msg = `${it.name}: 다음 모험에 가져가요`; }
    }
    if (b.dataset.sup === 'ex') {
      const n = Math.min(save.spoils, Number(b.dataset.n));
      if (n > 0) { save.spoils -= n; save.essence += n * SPOIL_TO_ESSENCE; msg = `✪${n} → ◆${n * SPOIL_TO_ESSENCE}`; }
    }
    onChange();
    draw();
  });
  const api = {
    isOpen: () => !root.hidden,
    open() { draw(); root.hidden = false; },
    close() { root.hidden = true; },
  };
  return api;
}
