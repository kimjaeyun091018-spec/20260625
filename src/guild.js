// 온라인 길드 (Firebase 익명 로그인 + Realtime Database REST)
// 서버 코드 없이 브라우저에서 바로 Firebase에 읽고 씁니다.
//
// 데이터 구조
//   guilds/{gid}      { name, color, desc, leader, xp, created, members: { uid: { name, role, contrib, joined } } }
//   guildIndex/{gid}  { name, color, desc, xp, n }      ← 길드 찾기·랭킹용 요약
//   guildNames/{key}  gid                               ← 이름 중복 막기
//   guildChat/{gid}/{msgId} { uid, name, text, t }
//   users/{uid}       { name, guild }
import { FIREBASE } from './config.js';
import { GUILD, guildLevel } from './data.js';

const CFG_KEY = 'sk-firebase';
let account = 'guest';

const safeGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 무시 */ } };

export function setGuildAccount(id) { account = id || 'guest'; }

// config.js 값이 우선, 비어 있으면 게임 안에서 붙여 넣은 값
export function firebaseConfig() {
  const local = safeGet(CFG_KEY) || {};
  return {
    apiKey: FIREBASE.apiKey || local.apiKey || '',
    databaseURL: (FIREBASE.databaseURL || local.databaseURL || '').replace(/\/+$/, ''),
    fromFile: !!(FIREBASE.apiKey && FIREBASE.databaseURL),
  };
}
export function saveFirebaseConfig(apiKey, databaseURL) {
  safeSet(CFG_KEY, { apiKey: String(apiKey).trim(), databaseURL: String(databaseURL).trim() });
}
export const guildReady = () => { const c = firebaseConfig(); return !!(c.apiKey && /^https:\/\/.+/.test(c.databaseURL)); };

// ---------- 로그인 (익명) ----------
const authKey = () => `sk-fb-auth:${account}`;
let session = null;

async function postJson(url, body, form = false) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
    body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return data;
}

async function auth() {
  const { apiKey } = firebaseConfig();
  if (session && session.exp > Date.now() + 60000) return session;
  const saved = session || safeGet(authKey());
  let r;
  if (saved?.refreshToken) {
    try {
      r = await postJson(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, true);
      session = { uid: r.user_id, idToken: r.id_token, refreshToken: r.refresh_token, exp: Date.now() + Number(r.expires_in) * 1000 };
    } catch { r = null; }
  }
  if (!r) {
    r = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, { returnSecureToken: true });
    session = { uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, exp: Date.now() + Number(r.expiresIn) * 1000 };
  }
  safeSet(authKey(), { uid: session.uid, refreshToken: session.refreshToken });
  return session;
}

async function db(method, path, body, query = '') {
  const s = await auth();
  const url = `${firebaseConfig().databaseURL}/${path}.json?auth=${encodeURIComponent(s.idToken)}${query}`;
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? '권한이 없어요 (데이터베이스 규칙을 확인하세요)' : data?.error || `HTTP ${res.status}`);
  return data;
}

const TS = { '.sv': 'timestamp' };
const inc = (n) => ({ '.sv': { increment: n } });
// 길드 이름 → 데이터베이스 키 (Firebase 키에 못 쓰는 . $ # [ ] / 는 _ 로), 주소에 넣을 때는 인코딩
const nameKey = (name) => encodeURIComponent(name.trim().toLowerCase().replace(/[.$#[\]/%]/g, '_'));
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

// ---------- 읽기 ----------
export async function whoAmI() {
  const s = await auth();
  const me = (await db('GET', `users/${s.uid}`)) || {};
  return { uid: s.uid, name: me.name || '', guild: me.guild || null };
}

export async function listGuilds() {
  const idx = (await db('GET', 'guildIndex')) || {};
  return Object.entries(idx).map(([id, g]) => ({ id, ...g, lv: guildLevel(g.xp || 0) })).sort((a, b) => (b.xp || 0) - (a.xp || 0));
}

export async function getGuild(gid) {
  const g = await db('GET', `guilds/${gid}`);
  if (!g) return null;
  const members = Object.entries(g.members || {}).map(([uid, m]) => ({ uid, ...m })).sort((a, b) => (b.contrib || 0) - (a.contrib || 0));
  return { id: gid, ...g, members, lv: guildLevel(g.xp || 0) };
}

export async function loadChat(gid) {
  const c = (await db('GET', `guildChat/${gid}`, undefined, '&orderBy=%22$key%22&limitToLast=40')) || {};
  return Object.entries(c).map(([id, m]) => ({ id, ...m })).sort((a, b) => (a.t || 0) - (b.t || 0));
}

// ---------- 쓰기 ----------
async function refreshIndex(gid) {
  const g = await db('GET', `guilds/${gid}`);
  if (!g) return;
  await db('PATCH', `guildIndex/${gid}`, { name: g.name, color: g.color, desc: g.desc || '', xp: g.xp || 0, n: Object.keys(g.members || {}).length });
}

export async function createGuild({ name, color, desc, playerName }) {
  const s = await auth();
  name = clean(name, 12);
  if (name.length < 2) throw new Error('길드 이름은 2~12글자예요');
  const me = await whoAmI();
  if (me.guild) throw new Error('이미 길드에 들어가 있어요');
  if (await db('GET', `guildNames/${nameKey(name)}`)) throw new Error('같은 이름의 길드가 있어요');
  const { name: gid } = await db('POST', 'guilds', {
    name, color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffd54f', desc: clean(desc, 60), leader: s.uid, xp: 0, created: TS,
    members: { [s.uid]: { name: clean(playerName, 10) || '길드장', role: 'leader', contrib: 0, joined: TS } },
  });
  await db('PUT', `guildNames/${nameKey(name)}`, gid);
  await db('PATCH', `users/${s.uid}`, { guild: gid, name: clean(playerName, 10) });
  await refreshIndex(gid);
  return gid;
}

export async function joinGuild(gid, playerName) {
  const s = await auth();
  const me = await whoAmI();
  if (me.guild) throw new Error('이미 길드에 들어가 있어요');
  const g = await getGuild(gid);
  if (!g) throw new Error('없어진 길드예요');
  if (g.members.length >= GUILD.maxMembers) throw new Error(`길드가 가득 찼어요 (${GUILD.maxMembers}명)`);
  await db('PUT', `guilds/${gid}/members/${s.uid}`, { name: clean(playerName, 10) || '길드원', role: 'member', contrib: 0, joined: TS });
  await db('PATCH', `users/${s.uid}`, { guild: gid, name: clean(playerName, 10) });
  await refreshIndex(gid);
}

export async function leaveGuild() {
  const s = await auth();
  const me = await whoAmI();
  if (!me.guild) return;
  const g = await getGuild(me.guild);
  if (g) {
    const rest = g.members.filter((m) => m.uid !== s.uid);
    if (!rest.length) {
      // 마지막 사람이 나가면 길드 해산 (채팅은 아직 길드원일 때 지워야 규칙에 맞음)
      await db('DELETE', `guildChat/${g.id}`).catch(() => {});
      await db('DELETE', `guildIndex/${g.id}`);
      await db('DELETE', `guildNames/${nameKey(g.name)}`);
      await db('DELETE', `guilds/${g.id}`);
    } else {
      if (g.leader === s.uid) {
        // 길드장이 나가면 기여도 1등에게 넘김
        await db('PATCH', `guilds/${g.id}`, { leader: rest[0].uid, [`members/${rest[0].uid}/role`]: 'leader' });
      }
      await db('DELETE', `guilds/${g.id}/members/${s.uid}`);
      await refreshIndex(g.id);
    }
  }
  await db('PATCH', `users/${s.uid}`, { guild: null });
}

export async function kickMember(gid, uid) {
  const s = await auth();
  const g = await getGuild(gid);
  if (!g || g.leader !== s.uid || uid === s.uid) throw new Error('길드장만 내보낼 수 있어요');
  await db('DELETE', `guilds/${gid}/members/${uid}`);
  await db('PATCH', `users/${uid}`, { guild: null }).catch(() => {});
  await refreshIndex(gid);
}

// 정수 기부 → 길드 경험치 (서버에서 더하기라 동시에 기부해도 안전)
export async function donate(gid, amount) {
  const s = await auth();
  amount = Math.floor(amount);
  if (!(amount > 0)) throw new Error('기부할 정수를 적어 주세요');
  await db('PATCH', `guilds/${gid}`, { xp: inc(amount), [`members/${s.uid}/contrib`]: inc(amount) });
  await refreshIndex(gid);
}

export async function sendChat(gid, name, text) {
  const s = await auth();
  text = clean(text, 120);
  if (!text) return;
  await db('POST', `guildChat/${gid}`, { uid: s.uid, name: clean(name, 10), text, t: TS });
}

export const myUid = () => session?.uid || safeGet(authKey())?.uid || null;
