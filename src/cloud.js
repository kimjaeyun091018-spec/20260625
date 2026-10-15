// 구글 계정 연동 + 클라우드 저장
//
// 구글 로그인 창은 Firebase 공식 라이브러리(팝업)로 띄우고, 그 뒤 로그인 유지·데이터베이스는
// guild.js의 REST 방식을 그대로 씁니다.
// 처음 구글로 로그인하면 지금 쓰던 익명 로그인에 구글을 '이어 붙여서' 길드·이름이 그대로 남습니다.
//
// 저장 위치: saves/{uid} = { data: "저장 JSON 문자열", t: 마지막 저장 시각 }
//   (배열·빈 칸이 Firebase에서 사라지지 않게 문자열로 통째로 저장)
import { firebaseConfig, guildReady, postJson, db, existingAnonSession } from './guild.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
let sdk = null;
let sdkPromise = null;

// 팝업은 버튼을 누른 그 순간에 열어야 막히지 않아서, 라이브러리를 미리 받아 둡니다.
export function preloadGoogle() {
  if (sdk) return Promise.resolve(sdk);
  if (!guildReady()) return Promise.reject(new Error('Firebase 설정이 아직 없어요'));
  if (!sdkPromise) {
    sdkPromise = Promise.all([import(`${SDK}firebase-app.js`), import(`${SDK}firebase-auth.js`)])
      .then(([app, au]) => {
        const c = firebaseConfig();
        const a = app.getApps().find((x) => x.name === 'sk-google')
          || app.initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain, databaseURL: c.databaseURL }, 'sk-google');
        const auth = au.getAuth(a);
        au.setPersistence(auth, au.inMemoryPersistence).catch(() => {});
        sdk = { au, auth };
        return sdk;
      })
      .catch((e) => { sdkPromise = null; throw e; });
  }
  return sdkPromise;
}
export const googleReady = () => !!sdk;

// 구글 자격 증명 → Firebase 로그인 (idToken을 주면 그 계정에 구글을 이어 붙임)
async function signInWithGoogleCred(cred, linkTo) {
  const { apiKey } = firebaseConfig();
  const postBody = cred.idToken ? `id_token=${cred.idToken}&providerId=google.com` : `access_token=${cred.accessToken}&providerId=google.com`;
  const r = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${apiKey}`, {
    postBody, requestUri: location.origin.startsWith('http') ? location.origin : 'http://localhost', returnSecureToken: true,
    ...(linkTo ? { idToken: linkTo } : {}),
  });
  if (r.errorMessage) throw new Error(r.errorMessage);
  return { uid: r.localId, idToken: r.idToken, refreshToken: r.refreshToken, exp: Date.now() + Number(r.expiresIn || 3600) * 1000 };
}

const ERR = {
  'auth/popup-blocked': '팝업이 막혔어요. 브라우저에서 팝업을 허용하고 다시 눌러 주세요',
  'auth/popup-closed-by-user': '로그인 창을 닫았어요',
  'auth/cancelled-popup-request': '로그인 창을 닫았어요',
  'auth/unauthorized-domain': '이 주소가 Firebase 승인된 도메인에 없어요 (README의 구글 로그인 설정 참고)',
  'auth/operation-not-allowed': 'Firebase에서 Google 로그인이 꺼져 있어요 (README의 구글 로그인 설정 참고)',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요',
};
export const googleError = (e) => ERR[e?.code] || e?.message || String(e);

// 구글 로그인. 반환: { session, profile, linked }
export async function googleSignIn() {
  if (!sdk) {
    await preloadGoogle();
    throw new Error('로그인 준비가 끝났어요. 버튼을 한 번 더 눌러 주세요');
  }
  const { au, auth } = sdk;
  const provider = new au.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await au.signInWithPopup(auth, provider); // ← 반드시 맨 먼저 (팝업 차단 방지)
  const user = result.user;
  const profile = { name: user.displayName || '', email: user.email || '' };
  const cred = au.GoogleAuthProvider.credentialFromResult(result);
  const isNew = !!au.getAdditionalUserInfo(result)?.isNewUser;

  let session = null;
  let linked = false;
  let deleted = false;
  // 처음 쓰는 구글 계정 + 지금 익명 로그인이 있으면 → 방금 생긴 빈 계정을 지우고 익명 계정에 구글을 이어 붙임
  const anon = isNew && cred ? await existingAnonSession() : null;
  if (anon) {
    try {
      await au.deleteUser(user);
      deleted = true;
      session = await signInWithGoogleCred(cred, anon.idToken);
      linked = true;
    } catch (e) { console.warn('구글 연결 실패, 새 계정으로 로그인', e); }
  }
  if (!session && deleted) session = await signInWithGoogleCred(cred);
  if (!session) {
    session = { uid: user.uid, idToken: await user.getIdToken(), refreshToken: user.refreshToken, exp: Date.now() + 3300e3 };
  }
  au.signOut(auth).catch(() => {});
  return { session, profile, linked };
}

// ---------- 클라우드 저장 ----------
export async function pullSave(uid) {
  const r = await db('GET', `saves/${uid}`);
  if (!r?.data) return null;
  try { return { save: JSON.parse(r.data), t: Number(r.t) || 0 }; } catch { return null; }
}

let pending = null;
let timer = 0;
let status = '';
let listener = null;
export const cloudStatus = () => status;
export function onCloudStatus(fn) { listener = fn; }
const setStatus = (s) => { status = s; listener?.(s); };

// 저장할 때마다 부르면 잠깐 모았다가 한 번에 올림
export function queuePush(uid, save) {
  pending = { uid, data: JSON.stringify(save), t: save._t || Date.now() };
  clearTimeout(timer);
  timer = setTimeout(flushPush, 2500);
  setStatus('올리는 중…');
}
export async function flushPush() {
  clearTimeout(timer);
  if (!pending) return;
  const p = pending;
  pending = null;
  try {
    await db('PUT', `saves/${p.uid}`, { data: p.data, t: p.t });
    setStatus('클라우드에 저장됨');
  } catch (e) {
    setStatus(`클라우드 저장 실패: ${e.message}`);
    if (!pending) pending = p; // 다음에 다시 시도
  }
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPush(); });
addEventListener('pagehide', () => flushPush());
