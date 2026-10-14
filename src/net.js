// PeerJS(WebRTC P2P) 기반 멀티플레이 연결
// - 방장 브라우저가 "서버" 역할: 게임을 계산하고 상태를 뿌립니다.
// - 참가자는 입력만 보내고 상태를 받습니다.
// - 서로를 찾는 과정(시그널링)만 PeerJS 무료 공개 서버를 사용합니다.

const PREFIX = 'sk20260625-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0,O,1,I) 제외

export function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function ensurePeerJs() {
  if (typeof window.Peer !== 'function') {
    throw new Error('PeerJS를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
}

export function describeError(err) {
  switch (err?.type) {
    case 'peer-unavailable': return '그 코드의 방을 찾을 수 없어요.';
    case 'unavailable-id': return '방 코드가 이미 사용 중이에요.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return '연결 서버에 접속하지 못했어요. 네트워크를 확인해 주세요.';
    case 'browser-incompatible': return '이 브라우저는 P2P 연결을 지원하지 않아요.';
    default: return err?.message || String(err);
  }
}

/**
 * 방 만들기.
 * handlers.onJoin(id, name) -> true면 입장 허용, false면 거절(방 꽉 참)
 * handlers.onInput(id, input), handlers.onLeave(id), handlers.onError(err)
 */
export function hostRoom(code, handlers) {
  ensurePeerJs();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(PREFIX + code);
    const conns = new Map();
    let opened = false;

    peer.on('open', () => {
      opened = true;
      resolve({
        code,
        broadcast(msg) {
          for (const c of conns.values()) if (c.open) c.send(msg);
        },
        playerCount: () => conns.size,
        close() { peer.destroy(); },
      });
    });

    peer.on('error', (err) => {
      if (!opened) { peer.destroy(); reject(err); }
      else handlers.onError?.(err);
    });

    peer.on('connection', (conn) => {
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'join') {
          if (conns.has(conn.peer)) return;
          if (!handlers.onJoin(conn.peer, msg.name)) {
            conn.send({ t: 'full' });
            setTimeout(() => conn.close(), 300);
            return;
          }
          conns.set(conn.peer, conn);
          conn.send({ t: 'welcome', id: conn.peer });
        } else if (msg.t === 'in' && conns.has(conn.peer)) {
          handlers.onInput(conn.peer, msg.i);
        }
      });
      conn.on('close', () => {
        if (conns.delete(conn.peer)) handlers.onLeave(conn.peer);
      });
    });
  });
}

/**
 * 방 참가하기.
 * handlers.onWelcome(myId), onState(snapshot), onClose(reason)
 */
export function joinRoom(code, name, handlers) {
  ensurePeerJs();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer();
    let joined = false;
    let timer = null;

    const fail = (err) => {
      clearTimeout(timer);
      if (!joined) { peer.destroy(); reject(err); }
      else handlers.onClose?.(describeError(err));
    };

    peer.on('error', fail);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      timer = setTimeout(() => fail({ type: 'peer-unavailable' }), 10000);

      conn.on('open', () => conn.send({ t: 'join', name }));
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'welcome') {
          clearTimeout(timer);
          joined = true;
          handlers.onWelcome(msg.id);
          resolve({
            send(m) { if (conn.open) conn.send(m); },
            close() { peer.destroy(); },
          });
        } else if (msg.t === 's') {
          handlers.onState(msg.s);
        } else if (msg.t === 'map') {
          handlers.onMap?.(msg.m);
        } else if (msg.t === 'full') {
          fail(new Error('방이 가득 찼어요 (최대 4명).'));
        }
      });
      conn.on('close', () => {
        if (joined) handlers.onClose?.('방장과의 연결이 끊겼어요.');
      });
    });
  });
}
