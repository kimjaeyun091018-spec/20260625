// 길드 회관 화면 (로비의 길드 회관에서 E, 또는 메뉴의 길드 버튼)
import { GUILD, guildLevel, guildPerks, SPOIL_GUILD_XP } from './data.js';
import {
  guildReady, firebaseConfig, saveFirebaseConfig, whoAmI, listGuilds, getGuild, loadChat,
  createGuild, joinGuild, leaveGuild, kickMember, donate, sendChat, myUid,
} from './guild.js';
import { writeSave } from './tree.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#ffd54f', '#ef5350', '#42a5f5', '#66bb6a', '#ab47bc', '#ff7043', '#26c6da', '#eceff1'];

export function createGuildUI(root, { getSave, getName, onChange }) {
  let tab = 'home';
  let busy = false;
  let msg = '';
  let me = null, guild = null, list = [], chat = [], search = '';
  let chatTimer = null;

  // 게임 빌드에 붙일 길드 정보 (보너스 계산용) 를 저장 데이터에 기억
  function remember() {
    const save = getSave();
    save.guild = guild ? { id: guild.id, name: guild.name, lv: guild.lv, color: guild.color } : null;
    writeSave(save);
    onChange();
  }

  async function run(fn, okMsg = '') {
    if (busy) return;
    busy = true;
    msg = '불러오는 중…';
    draw();
    try {
      await fn();
      msg = okMsg;
    } catch (e) {
      msg = `⚠ ${e.message || e}`;
    }
    busy = false;
    draw();
  }

  async function refresh() {
    me = await whoAmI();
    guild = me.guild ? await getGuild(me.guild) : null;
    if (guild && !guild.members.some((m) => m.uid === me.uid)) guild = null; // 내보내졌으면
    if (!guild) list = await listGuilds();
    if (guild) chat = await loadChat(guild.id);
    remember();
  }

  function setupHtml() {
    const c = firebaseConfig();
    return `<div class="gsetup">
      <p>온라인 길드는 <b>Firebase</b>(구글의 무료 서버)에 저장돼요. 처음 한 번만 설정하면 됩니다.</p>
      <ol>
        <li><a href="https://console.firebase.google.com" target="_blank" rel="noopener">Firebase 콘솔</a>에서 프로젝트 만들기</li>
        <li>Authentication → 로그인 방법 → <b>익명</b> 켜기</li>
        <li>Realtime Database 만들기 → 규칙 탭에 README의 <b>길드 서버 규칙</b> 붙여 넣고 게시</li>
        <li>프로젝트 설정 → 웹 앱 추가 → <b>apiKey</b>와 <b>databaseURL</b>을 아래에 붙여 넣기</li>
      </ol>
      <label class="field">apiKey<input data-g="key" value="${esc(c.apiKey)}" placeholder="AIza…" autocomplete="off"></label>
      <label class="field">databaseURL<input data-g="url" value="${esc(c.databaseURL)}" placeholder="https://프로젝트-default-rtdb.firebaseio.com" autocomplete="off"></label>
      <button data-gact="savecfg" class="primary">저장하고 연결</button>
      <p class="hint">같이 할 친구들도 같은 값을 넣어야 같은 길드 서버를 써요. 저장소의 src/config.js에 적어 두면 모두에게 자동으로 적용돼요.</p>
    </div>`;
  }

  function perksHtml(lv) {
    const p = guildPerks(lv);
    return `정수 +${Math.round(p.ess * 100)}% · 피해 +${Math.round(p.dmg * 100)}% · 성 체력 +${p.castleHp} · 소환 비용 -${Math.round(p.summon * 100)}% · 같은 방 길드원 1명마다 피해 +5%`;
  }

  function myGuildHtml() {
    const g = guild, lv = g.lv, next = GUILD.levelXp(lv), prev = lv > 1 ? GUILD.levelXp(lv - 1) : 0;
    const pct = lv >= GUILD.maxLv ? 100 : Math.round(((g.xp - prev) / (next - prev)) * 100);
    const leader = g.leader === me.uid;
    const members = g.members.map((m) => `<li><span class="gname">${m.role === 'leader' ? '👑 ' : ''}${esc(m.name)}${m.uid === me.uid ? ' (나)' : ''}</span>
      <span class="gcon">기여 ◆${m.contrib || 0}</span>${leader && m.uid !== me.uid ? `<button class="link" data-gact="kick" data-uid="${esc(m.uid)}">내보내기</button>` : ''}</li>`).join('');
    if (tab === 'chat') {
      return `<div class="gchat">${chat.map((c) => `<p><b style="color:${c.uid === me.uid ? '#ffd54f' : '#90caf9'}">${esc(c.name)}</b> ${esc(c.text)}</p>`).join('') || '<p class="hint">아직 대화가 없어요</p>'}</div>
        <div class="grow"><input data-g="chat" maxlength="120" placeholder="메시지 (Enter)" autocomplete="off"><button data-gact="send">보내기</button></div>`;
    }
    return `<div class="ghead" style="--c:${esc(g.color)}"><b>${esc(g.name)}</b> <span>Lv ${lv}</span><small>${esc(g.desc || '')}</small></div>
      <div class="gbar"><i style="width:${pct}%"></i></div>
      <p class="hint">길드 경험치 ${g.xp}${lv < GUILD.maxLv ? ` / ${next}` : ' (최대)'} · 길드원 ${g.members.length}/${GUILD.maxMembers}</p>
      <p class="gperk">길드 보너스: ${perksHtml(lv)}</p>
      <div class="grow"><input data-g="amount" type="number" min="1" placeholder="기부할 정수" value="20"><button data-gact="donate">◆ 기부 (내 정수 ${getSave().essence})</button></div>
      <div class="grow"><input data-g="spoils" type="number" min="1" placeholder="기부할 전리품" value="1"><button data-gact="donateSp">✪ 기부 (✪1 = 경험치 ${SPOIL_GUILD_XP}, 내 전리품 ${getSave().spoils || 0})</button></div>
      <ul class="glist">${members}</ul>
      <button class="danger" data-gact="leave">길드 나가기</button>`;
  }

  function findHtml() {
    const shown = list.filter((g) => !search || g.name.toLowerCase().includes(search.toLowerCase()));
    return `<div class="grow"><input data-g="search" value="${esc(search)}" placeholder="길드 이름 검색" autocomplete="off"><button data-gact="reload">새로고침</button></div>
      <ul class="glist">${shown.map((g) => `<li><span class="gname" style="color:${esc(g.color)}">${esc(g.name)}</span>
        <span class="gcon">Lv ${g.lv} · ${g.n || 0}/${GUILD.maxMembers}명</span><small>${esc(g.desc || '')}</small>
        <button data-gact="join" data-gid="${esc(g.id)}" ${(g.n || 0) >= GUILD.maxMembers ? 'disabled' : ''}>가입</button></li>`).join('') || '<li class="hint">아직 길드가 없어요. 첫 길드를 만들어 보세요!</li>'}</ul>`;
  }

  function createHtml() {
    return `<label class="field">길드 이름 (2~12글자)<input data-g="name" maxlength="12" autocomplete="off"></label>
      <label class="field">소개 (선택)<input data-g="desc" maxlength="60" autocomplete="off"></label>
      <div class="gcolors">${COLORS.map((c, i) => `<label><input type="radio" name="gcolor" value="${c}" ${i === 0 ? 'checked' : ''}><i style="background:${c}"></i></label>`).join('')}</div>
      <button class="primary" data-gact="create" ${getSave().essence < GUILD.createCost ? 'disabled' : ''}>길드 만들기 (◆${GUILD.createCost})</button>`;
  }

  function rankHtml() {
    return `<ol class="glist rank">${list.slice(0, 30).map((g) => `<li><span class="gname" style="color:${esc(g.color)}">${esc(g.name)}</span><span class="gcon">Lv ${g.lv} · 경험치 ${g.xp || 0} · ${g.n || 0}명</span></li>`).join('') || '<li class="hint">아직 길드가 없어요</li>'}</ol>`;
  }

  function draw() {
    const ready = guildReady();
    let body, tabs = '';
    if (!ready || tab === 'setup') body = setupHtml();
    else if (!me) body = '<p class="hint">연결하는 중…</p>';
    else {
      const t = guild ? [['home', '내 길드'], ['chat', '채팅'], ['rank', '랭킹']] : [['home', '길드 찾기'], ['create', '만들기'], ['rank', '랭킹']];
      tabs = `<div class="btabs">${t.map(([k, n]) => `<button class="btab${tab === k ? ' on' : ''}" data-gtab="${k}">${n}</button>`).join('')}<button class="btab" data-gtab="setup">서버 설정</button></div>`;
      body = tab === 'rank' ? rankHtml() : guild ? myGuildHtml() : tab === 'create' ? createHtml() : findHtml();
    }
    root.innerHTML = `<div class="tree-head"><h2>길드 회관</h2><button data-gact="close" class="tclose">닫기 (Esc)</button></div>
      ${tabs}<div class="gbody">${body}</div><p class="tmsg" role="status">${esc(msg)}</p>`;
    const box = root.querySelector('.gchat');
    if (box) box.scrollTop = box.scrollHeight;
  }

  const val = (k) => root.querySelector(`[data-g="${k}"]`)?.value ?? '';

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-gtab]');
    if (t) {
      tab = t.dataset.gtab;
      msg = '';
      if (tab === 'rank' && guildReady()) run(async () => { list = await listGuilds(); });
      else if (tab === 'chat' && guild) run(async () => { chat = await loadChat(guild.id); });
      else draw();
      return;
    }
    const b = e.target.closest('[data-gact]');
    if (!b || b.disabled) return;
    const save = getSave();
    switch (b.dataset.gact) {
      case 'close': api.close(); break;
      case 'savecfg':
        saveFirebaseConfig(val('key'), val('url'));
        tab = 'home';
        run(refresh, guildReady() ? '연결됐어요!' : '');
        break;
      case 'reload': run(async () => { list = await listGuilds(); }); break;
      case 'join': run(async () => { await joinGuild(b.dataset.gid, getName()); tab = 'home'; await refresh(); }, '길드에 가입했어요!'); break;
      case 'create': {
        // 화면이 다시 그려지기 전에 입력값을 먼저 읽어 둠
        const color = root.querySelector('input[name="gcolor"]:checked')?.value;
        const name = val('name'), desc = val('desc');
        if (save.essence < GUILD.createCost) break;
        run(async () => {
          await createGuild({ name, desc, color, playerName: getName() });
          save.essence -= GUILD.createCost;
          tab = 'home';
          await refresh();
        }, '길드를 만들었어요!');
        break;
      }
      case 'donate': {
        const n = Math.min(save.essence, Math.floor(Number(val('amount')) || 0));
        if (n <= 0) { msg = '기부할 정수가 없어요'; draw(); break; }
        run(async () => { await donate(guild.id, n); save.essence -= n; await refresh(); }, `◆${n} 기부했어요!`);
        break;
      }
      case 'donateSp': {
        const n = Math.min(save.spoils || 0, Math.floor(Number(val('spoils')) || 0));
        if (n <= 0) { msg = '기부할 전리품이 없어요'; draw(); break; }
        run(async () => { await donate(guild.id, n * SPOIL_GUILD_XP); save.spoils -= n; await refresh(); }, `✪${n} 기부했어요! (길드 경험치 +${n * SPOIL_GUILD_XP})`);
        break;
      }
      case 'leave':
        if (!window.confirm('정말 길드를 나갈까요? (마지막 길드원이면 길드가 없어져요)')) break;
        run(async () => { await leaveGuild(); tab = 'home'; await refresh(); }, '길드를 나왔어요');
        break;
      case 'kick': run(async () => { await kickMember(guild.id, b.dataset.uid); await refresh(); }, '내보냈어요'); break;
      case 'send': {
        const text = val('chat');
        if (!text.trim()) break;
        run(async () => { await sendChat(guild.id, getName(), text); chat = await loadChat(guild.id); });
        break;
      }
      default:
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset?.g === 'search') {
      search = e.target.value;
      const pos = e.target.selectionStart;
      draw();
      const el = root.querySelector('[data-g="search"]');
      el?.focus();
      el?.setSelectionRange(pos, pos);
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset?.g === 'chat') root.querySelector('[data-gact="send"]')?.click();
    if (e.key !== 'Escape') e.stopPropagation(); // 입력 중 게임 키가 눌리지 않게
  });

  const api = {
    isOpen: () => !root.hidden,
    open() {
      root.hidden = false;
      tab = 'home';
      msg = '';
      draw();
      if (guildReady()) run(refresh);
      clearInterval(chatTimer);
      // 채팅 탭을 보고 있으면 5초마다 새 메시지 확인
      chatTimer = setInterval(() => {
        if (root.hidden) { clearInterval(chatTimer); return; }
        if (tab === 'chat' && guild && !busy) loadChat(guild.id).then((c) => { if (JSON.stringify(c) !== JSON.stringify(chat)) { chat = c; const typing = val('chat'); draw(); const el = root.querySelector('[data-g="chat"]'); if (el) { el.value = typing; el.focus(); } } }).catch(() => {});
      }, 5000);
    },
    close() { root.hidden = true; clearInterval(chatTimer); },
    // 게임을 켤 때 조용히 길드 정보 갱신 (보너스 반영)
    async quietRefresh() { if (!guildReady()) return; try { await refresh(); } catch { /* 오프라인 */ } },
  };
  return api;
}

export { myUid, guildLevel };
