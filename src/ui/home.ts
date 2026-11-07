import { normalizeRoomCode, isValidRoomCode } from '../core/roomCode';

export interface HomeEvents {
  onCreate(): void;
  onJoin(code: string): void;
}

export function renderHome(root: HTMLElement, events: HomeEvents): void {
  root.innerHTML = `
    <main class="home">
      <h1 class="logo">空投</h1>
      <p class="tagline">点对点文件互传 · 文件不经过任何服务器 · 支持超大文件与断点续传</p>
      <div class="home-cards">
        <section class="card">
          <h2>我要发文件</h2>
          <p>创建一个房间，把房间码发给对方</p>
          <button id="create" class="btn primary big">创建房间</button>
        </section>
        <section class="card">
          <h2>我要收文件</h2>
          <p>输入对方给你的 6 位房间码</p>
          <form id="join-form" class="join-row">
            <input id="join-code" maxlength="12" placeholder="例如 K7M2PQ" autocomplete="off" />
            <button type="submit" class="btn primary big">加入</button>
          </form>
          <p id="join-error" class="error" hidden>房间码格式不对，应为 6 位字母数字</p>
        </section>
      </div>
      <p class="note">双方需同时在线；推荐使用 Chrome / Edge。传输期间请保持本页面打开。</p>
    </main>`;

  root.querySelector('#create')!.addEventListener('click', events.onCreate);
  const input = root.querySelector<HTMLInputElement>('#join-code')!;
  const error = root.querySelector<HTMLElement>('#join-error')!;
  root.querySelector('#join-form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeRoomCode(input.value);
    if (!isValidRoomCode(code)) {
      error.hidden = false;
      return;
    }
    error.hidden = true;
    events.onJoin(code);
  });
}
