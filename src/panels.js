// 설정 · 옷장(스킨) · 계정(로그인, 저장 코드) 화면
import { SKINS } from './data.js';
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
export const settings = { autoAim: false, damageNumbers: true, ...safeGet(SETTINGS_KEY, {}) };

export function createSettingsUI(root) {
  function draw() {
    root.innerHTML = `
      <h2>설정</h2>
      <label class="toggle"><input type="checkbox" data-set="autoAim" ${settings.autoAim ? 'checked' : ''}>
        <span><b>오토에임 (Enter 공격)</b><small>Enter를 누르고 있으면 가장 가까운 적을 자동으로 조준해서 공격합니다.
        스킬도 가까운 적을 노립니다. 마우스 없이 키보드만으로 플레이할 때 켜세요.</small></span></label>
      <label class="toggle"><input type="checkbox" data-set="damageNumbers" ${settings.damageNumbers ? 'checked' : ''}>
        <span><b>피해 숫자 표시</b><small>적에게 준 피해를 숫자로 보여 줍니다. 치명타는 노란색, 지속 피해는 회색.</small></span></label>
      <p class="help">키보드만으로: 이동 WASD · 공격 Enter(오토에임) · 무기 스킬 V · 궁극기 Q · 스킬 1~4 · 증강 카드 Z/X/C</p>
      <button data-close>닫기</button>`;
  }
  root.addEventListener('change', (e) => {
    const k = e.target.dataset?.set;
    if (!k) return;
    settings[k] = e.target.checked;
    safeSet(SETTINGS_KEY, settings);
  });
  root.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) api.close(); });
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
