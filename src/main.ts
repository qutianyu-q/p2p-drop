import './style.css';
import { generateRoomCode, normalizeRoomCode, isValidRoomCode } from './core/roomCode';
import { SenderSession } from './net/sender';
import { ReceiverSession } from './net/receiver';
import { renderHome } from './ui/home';
import {
  renderSenderRoom,
  renderReceiverRoom,
  senderHooks,
  receiverHooks,
  senderBannerText,
  receiverBannerText,
} from './ui/room';

const app = document.getElementById('app')!;
let sender: SenderSession | null = null;
let receiver: ReceiverSession | null = null;

function cleanup(): void {
  sender?.destroy();
  receiver?.destroy();
  sender = null;
  receiver = null;
  history.replaceState(null, '', location.pathname);
}

function goHome(): void {
  cleanup();
  renderHome(app, { onCreate: createRoomView, onJoin: (code) => void joinRoomView(code) });
  // 扫码/分享链接带入的房间码：#join=XXXXXX
  const match = location.hash.match(/^#join=([A-Za-z0-9]+)$/);
  if (match) {
    const code = normalizeRoomCode(match[1]);
    if (isValidRoomCode(code)) void joinRoomView(code);
  }
}

function createRoomView(): void {
  cleanup();
  const code = generateRoomCode();
  // 构造函数会同步触发 onState，回调里的 session 此时可能尚未赋值，WeakMap.get 返回 undefined 属正常
  let session: SenderSession;
  session = new SenderSession(code, {
    onState(state, detail) {
      const hooks = senderHooks.get(session);
      if (hooks) hooks.banner.textContent = senderBannerText(state, detail);
    },
    onChange() {
      senderHooks.get(session)?.schedule();
    },
  });
  sender = session;
  (window as unknown as { __sender: SenderSession }).__sender = session; // 联调调试句柄
  renderSenderRoom(app, session, goHome);
}

async function joinRoomView(code: string): Promise<void> {
  cleanup();
  try {
    let session: ReceiverSession;
    let lastState: Parameters<typeof receiverBannerText>[0] = 'connecting';
    let lastDetail: string | undefined;
    session = await ReceiverSession.join(code, {
      onState(state, detail) {
        lastState = state;
        lastDetail = detail;
        const hooks = receiverHooks.get(session);
        if (hooks) hooks.banner.textContent = receiverBannerText(state, detail);
      },
      onChange() {
        receiverHooks.get(session)?.schedule();
      },
    });
    receiver = session;
    (window as unknown as { __receiver: ReceiverSession }).__receiver = session; // 联调调试句柄
    renderReceiverRoom(app, session, goHome);
    // 连接事件可能先于渲染到达，渲染后补一次最新状态
    receiverHooks.get(session)!.banner.textContent = receiverBannerText(lastState, lastDetail);
  } catch (e) {
    alert(e instanceof Error ? e.message : '加入房间失败');
    goHome();
  }
}

window.addEventListener('beforeunload', (e) => {
  // 有进行中的传输时提示，避免误关页面
  const busy =
    sender?.entries.some((f) => f.status === 'sending') ||
    receiver?.entries.some((f) => f.status === 'receiving');
  if (busy) e.preventDefault();
});

goHome();
