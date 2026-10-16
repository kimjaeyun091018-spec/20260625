// 보관: 성 지키기와 함께 게임에서 뺀 화면들 (병영 · 보급관 · 성 강화)
// 원래 src/panels.js 안에 있던 코드입니다. 되살리려면 panels.js로 옮기고 main.js·index.html 연결을 복구하세요.
// 전체 동작하는 버전은 git 브랜치 archive/castle-defense-v1 에 있습니다.

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
        const tk = U.treasure;
        btn = U.crown ? '<small class="hint">스킬 트리 왕관 노드 「거인의 맹약」</small>'
          : tk ? `<small class="hint">🗺 모험 보물 「${esc(TREASURES[tk].name)}」로 합류</small>`
          : `<button data-army="unlock" data-k="${k}" ${save.essence < U.unlock ? 'disabled' : ''}>해금 ◆${U.unlock}</button>`;
      } else {
        btn = `<button data-army="sel" data-k="${k}" class="${sel >= 0 ? 'on' : ''}">${sel >= 0 ? `${4 + sel}번 키 ✔` : '데려가기'}</button>
          ${lv < UNIT_MAX_LV ? `<button data-army="up" data-k="${k}" ${save.essence < unitLevelCost(lv) ? 'disabled' : ''}>레벨업 ◆${unitLevelCost(lv)}</button>` : '<small>최대 레벨</small>'}`;
      }
      return `<div class="skin unit${own ? '' : ' locked'}${sel >= 0 ? ' on' : ''}">
        <img src="${preview(k)}" alt="" width="64" height="64">
        <b>${U.name} ${own ? `Lv${lv}` : '🔒'}</b>
        <small>${U.desc}</small>
        <small>체력 ${Math.round(U.hp * sc)} · ${U.heal ? `회복 ${Math.round(U.heal * sc * 10) / 10}` : `피해 ${Math.round(U.dmg * sc * 10) / 10}`} · 훈련 ${BARRACKS.trainTime(k)}초 · 지원 쿨 ${BARRACKS.supportCd[k]}초</small>
        ${btn}</div>`;
    }).join('');
    root.innerHTML = `<div class="tree-head"><h2>병영 · 군단 편성</h2><span class="ess">◆ ${save.essence} 정수</span><button data-army="close" class="tclose">닫기 (Esc)</button></div>
      <p class="sub">성 지키기에 데려갈 유닛 ${ARMY_SLOTS}종을 고르세요. 준비 단계엔 4·5·6·7 키로 <b>훈련</b>(기본 병력), 전투 중엔 같은 키로 <b>쿨타임 지원 소환</b>. 레벨이 높을수록 체력·피해 +15%씩.</p>
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

// ---------------------------------------------------------------- 성 강화 (성 지키기에서 T)
// 성 키우기처럼: 모험에서 모은 정수(◆)로 성 레벨업, 모험에서 들고 나온 무기(무기고)를 성 탑에 거치.
export function createKeepUI(root, { getSave, onChange, icon, isHost }) {
  let msg = '';
  function draw() {
    const save = getSave(), K = save.keep, lv = K.lv;
    const slots = KEEP.mountSlots(lv), cost = KEEP.lvCost(lv), max = lv >= KEEP.maxLv;
    const wname = (w) => `${w.el && ELEMENTS[w.el] ? `${ELEMENTS[w.el].name}의 ` : ''}${WEAPONS[w.k].name}`;
    const wcolor = (w) => (w.el && ELEMENTS[w.el] ? ELEMENTS[w.el].color : '#fff');
    const mountBoxes = Array.from({ length: 4 }, (_, i) => {
      if (i >= slots) return `<div class="mslot lock">🔒 성 Lv${i * 5}</div>`;
      const ai = K.mounts[i], w = K.armory[ai];
      return w ? `<div class="mslot on">${icon(w.k, 2)}<b style="color:${wcolor(w)}">${esc(wname(w))}</b><button data-unmount="${i}">내리기</button></div>`
        : '<div class="mslot">빈 거치대<small>아래 무기고에서 거치</small></div>';
    }).join('');
    const items = K.armory.map((w, i) => {
      const on = K.mounts.includes(i), W = WEAPONS[w.k];
      return `<div class="skin arm${on ? ' on' : ''}">${icon(w.k, 2)}<b style="color:${wcolor(w)}">${esc(wname(w))}</b>
        <small>${TIER_NAME[W.tier]} · ${W.kind === 'ranged' ? '원거리' : '근접(성 둘레 휩쓸기)'}${w.el ? ` · Lv${w.lv}` : ''}</small>
        ${on ? '<span class="owned">거치 중</span>' : `<button data-mount="${i}" ${K.mounts.length >= slots ? 'disabled' : ''}>거치</button>`}
        ${on ? '' : `<button data-scrap="${i}" class="danger">분해 ◆${5 * W.tier}</button>`}</div>`;
    }).join('') || '<p class="help">무기고가 비어 있어요. 모험 모드를 끝내거나 나오면 들고 있던 무기가 여기에 들어와요 (기본 권총 제외).</p>';
    root.innerHTML = `
      <div class="tree-head"><h2>성 강화</h2><span class="ess">◆ ${save.essence} 정수</span><button data-close class="tclose">닫기 (Esc)</button></div>
      <p class="sub">라운드 <b>${K.round}</b> (최고 ${K.best}) · 성 <b>Lv${lv}</b> · 성 체력 +${KEEP.hpPerLv * (lv - 1)} · 화살 +${Math.round(KEEP.arrowPerLv * (lv - 1) * 100)}% · 거치 무기 피해 x${KEEP.mountMul(lv).toFixed(2)}</p>
      ${isHost() ? '' : '<p class="help">지금 방의 성은 방장의 성이에요. 여기서 바꾼 건 내가 방장일 때 적용돼요.</p>'}
      <div class="buttons"><button data-up ${max || save.essence < cost ? 'disabled' : ''}>${max ? '성 최대 레벨' : `성 레벨업 ◆${cost}`}</button>
        <button data-bk ${K.bk >= BARRACKS.maxLv || save.essence < BARRACKS.cost(K.bk) ? 'disabled' : ''}>${K.bk >= BARRACKS.maxLv ? '훈련소 최대' : `훈련소 Lv${K.bk + 1} ◆${BARRACKS.cost(K.bk)}`}</button></div>
      <p class="help">훈련소 Lv${K.bk}: 기본 병력 ${BARRACKS.cap(K.bk)}명 · 지원 소환 쿨타임 ${Math.round(BARRACKS.cdMul(K.bk) * 100)}% (레벨마다 인원 +1, 쿨타임 -4%) · 훈련소는 내 것 (방장이 아니어도 적용)</p>
      <h3>무기 거치대 (${K.mounts.length}/${slots})</h3>
      <div class="mounts">${mountBoxes}</div>
      <h3>무기고 (${K.armory.length}/${KEEP.armoryMax}) · 모험에서 가져온 무기</h3>
      <div class="skins">${items}</div>
      <p class="tmsg">${esc(msg)}</p>`;
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { api.close(); return; }
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const save = getSave(), K = save.keep;
    if (b.hasAttribute('data-up')) {
      const cost = KEEP.lvCost(K.lv);
      if (K.lv >= KEEP.maxLv || save.essence < cost) return;
      save.essence -= cost; K.lv++;
      msg = `성 Lv${K.lv}!${K.lv % 5 === 0 && KEEP.mountSlots(K.lv) > KEEP.mountSlots(K.lv - 1) ? ' 무기 거치대가 하나 늘었어요.' : ''}`;
    } else if (b.hasAttribute('data-bk')) {
      const cost = BARRACKS.cost(K.bk);
      if (K.bk >= BARRACKS.maxLv || save.essence < cost) return;
      save.essence -= cost; K.bk++;
      msg = `훈련소 Lv${K.bk}! 기본 병력 ${BARRACKS.cap(K.bk)}명`;
    } else if (b.dataset.mount !== undefined) {
      const i = Number(b.dataset.mount);
      if (K.mounts.length < KEEP.mountSlots(K.lv) && !K.mounts.includes(i)) { K.mounts.push(i); msg = ''; }
    } else if (b.dataset.unmount !== undefined) {
      K.mounts.splice(Number(b.dataset.unmount), 1); msg = '';
    } else if (b.dataset.scrap !== undefined) {
      const i = Number(b.dataset.scrap);
      if (K.mounts.includes(i)) return;
      const w = K.armory[i];
      save.essence += 5 * WEAPONS[w.k].tier;
      K.armory.splice(i, 1);
      K.mounts = K.mounts.map((m) => (m > i ? m - 1 : m));
      msg = `${WEAPONS[w.k].name} 분해: ◆${5 * WEAPONS[w.k].tier}`;
    } else return;
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
