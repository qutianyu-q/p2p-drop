import QRCode from 'qrcode';
import { CHUNK_SIZE, chunkCount } from '../core/chunks';
import { SenderSession, type SenderState, type FileStatus } from '../net/sender';
import { ReceiverSession, type ReceiverState } from '../net/receiver';

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const senderStateText: Record<SenderState, string> = {
  creating: '正在创建房间…',
  waiting: '等待对方加入（请保持本页面打开）',
  connected: '对方已连接',
  error: '连接出错',
};
const receiverStateText: Record<ReceiverState, string> = {
  connecting: '正在连接…',
  connected: '已连接，等待对方发送文件',
  disconnected: '连接已断开。重新加入同一房间码即可续传未完成的文件',
  error: '连接出错',
};
const fileStatusText: Record<FileStatus, string> = {
  queued: '排队中',
  sending: '发送中',
  paused: '已暂停',
  sent: '已发完，等待对方保存',
  done: '已完成 ✓',
  cancelled: '已取消',
};

class SpeedMeter {
  private last = new Map<number, { bytes: number; time: number }>();
  speed(id: number, bytes: number): string {
    const now = Date.now();
    const prev = this.last.get(id);
    this.last.set(id, { bytes, time: now });
    if (!prev) return '';
    const dt = (now - prev.time) / 1000;
    if (dt < 0.5) return '';
    const v = (bytes - prev.bytes) / dt;
    return v > 0 ? `${formatSize(v)}/s` : '';
  }
}

function shell(root: HTMLElement, title: string, onExit: () => void): HTMLElement {
  root.innerHTML = `
    <main class="room">
      <header class="room-header">
        <button id="exit" class="btn ghost">← 返回</button>
        <h1>${title}</h1>
      </header>
      <div id="banner" class="banner"></div>
      <section id="body"></section>
    </main>`;
  root.querySelector('#exit')!.addEventListener('click', onExit);
  return root.querySelector('#body')!;
}

export function renderSenderRoom(root: HTMLElement, session: SenderSession, onExit: () => void): void {
  const body = shell(root, '发送文件', onExit);
  const banner = root.querySelector<HTMLElement>('#banner')!;
  const meter = new SpeedMeter();

  body.innerHTML = `
    <section class="card room-code-card">
      <div>
        <p>把房间码发给对方</p>
        <div class="room-code">${session.code}</div>
        <button id="copy" class="btn">复制房间码</button>
      </div>
      <canvas id="qr" title="扫码加入房间"></canvas>
    </section>
    <section id="dropzone" class="dropzone">
      <p>拖拽文件到这里，或</p>
      <div class="row">
        <button id="pick-files" class="btn primary">选择文件</button>
        <button id="pick-dir" class="btn">选择文件夹</button>
      </div>
      <input id="file-input" type="file" multiple hidden />
      <input id="dir-input" type="file" hidden />
    </section>
    <ul id="files" class="file-list"></ul>`;

  const dirInput = body.querySelector<HTMLInputElement>('#dir-input')!;
  dirInput.setAttribute('webkitdirectory', '');
  const fileInput = body.querySelector<HTMLInputElement>('#file-input')!;

  const joinUrl = `${location.origin}${location.pathname}#join=${session.code}`;
  QRCode.toCanvas(body.querySelector('#qr')!, joinUrl, { width: 132, margin: 1 });

  body.querySelector('#copy')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(session.code);
    body.querySelector('#copy')!.textContent = '已复制 ✓';
  });
  body.querySelector('#pick-files')!.addEventListener('click', () => fileInput.click());
  body.querySelector('#pick-dir')!.addEventListener('click', () => dirInput.click());

  type PickedFile = File & { webkitRelativePath?: string };
  const addFromInput = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []).map((f) => ({
      file: f,
      path: (f as PickedFile).webkitRelativePath || f.name,
    }));
    if (files.length) session.addFiles(files);
    input.value = '';
  };
  fileInput.addEventListener('change', () => addFromInput(fileInput));
  dirInput.addEventListener('change', () => addFromInput(dirInput));

  const dropzone = body.querySelector<HTMLElement>('#dropzone')!;
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('hover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('hover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('hover');
    const files = Array.from(e.dataTransfer?.files ?? []).map((f) => ({ file: f, path: f.name }));
    if (files.length) session.addFiles(files);
  });

  const list = body.querySelector<HTMLElement>('#files')!;
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'pause') session.pauseFile(id);
    else if (btn.dataset.act === 'resume') session.resumeFile(id);
    else if (btn.dataset.act === 'cancel') session.cancelFile(id);
  });

  let scheduled = false;
  const render = () => {
    scheduled = false;
    list.innerHTML = session.entries
      .map((entry) => {
        const { meta } = entry;
        const total = chunkCount(meta.size);
        const percent = total === 0 ? (entry.status === 'done' ? 100 : 0) : Math.floor((entry.acked / total) * 100);
        const bytes = Math.min(entry.acked * CHUNK_SIZE, meta.size);
        const speed = entry.status === 'sending' ? meter.speed(meta.id, bytes) : '';
        const actions =
          entry.status === 'sending'
            ? `<button class="btn small" data-act="pause" data-id="${meta.id}">暂停</button>`
            : entry.status === 'paused'
              ? `<button class="btn small" data-act="resume" data-id="${meta.id}">继续</button>`
              : '';
        const cancel =
          entry.status === 'done' || entry.status === 'cancelled'
            ? ''
            : `<button class="btn small danger" data-act="cancel" data-id="${meta.id}">取消</button>`;
        return `<li class="file-item">
          <div class="file-top">
            <span class="file-name" title="${escapeHtml(meta.path)}">${escapeHtml(meta.path)}</span>
            <span class="file-size">${formatSize(meta.size)}</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
          <div class="file-bottom">
            <span>${fileStatusText[entry.status]} · ${percent}% ${speed}</span>
            <span class="actions">${actions}${cancel}</span>
          </div>
        </li>`;
      })
      .join('');
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(render, 100); // 后台标签页 rAF 不触发，用定时器保证进度照常刷新
  };

  // 事件在 main.ts 中绑定：onState → banner，onChange → schedule
  senderHooks.set(session, { banner, schedule });
}

export const senderHooks = new WeakMap<SenderSession, { banner: HTMLElement; schedule: () => void }>();
export const receiverHooks = new WeakMap<ReceiverSession, { banner: HTMLElement; schedule: () => void }>();

export function renderReceiverRoom(root: HTMLElement, session: ReceiverSession, onExit: () => void): void {
  const body = shell(root, `接收文件 · 房间 ${session.code}`, onExit);
  const banner = root.querySelector<HTMLElement>('#banner')!;
  const meter = new SpeedMeter();
  body.innerHTML = `
    <p class="note">文件将直接保存到你的设备。推荐使用 Chrome / Edge 以获得超大文件直写磁盘的能力。</p>
    <ul id="files" class="file-list"></ul>
    <p id="empty" class="note">对方添加文件后会自动出现在这里</p>`;

  const list = body.querySelector<HTMLElement>('#files')!;
  const empty = body.querySelector<HTMLElement>('#empty')!;
  list.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'accept') void session.accept(id);
    else if (btn.dataset.act === 'cancel') session.cancel(id);
  });

  let scheduled = false;
  const render = () => {
    scheduled = false;
    empty.hidden = session.entries.length > 0;
    list.innerHTML = session.entries
      .map((entry) => {
        const { meta } = entry;
        const total = chunkCount(meta.size);
        const percent = total === 0 ? (entry.status === 'done' ? 100 : 0) : Math.floor((entry.received / total) * 100);
        const bytes = Math.min(entry.received * CHUNK_SIZE, meta.size);
        const speed = entry.status === 'receiving' ? meter.speed(meta.id, bytes) : '';
        const statusText =
          entry.status === 'idle'
            ? entry.resumable
              ? '有未完成的进度，可续传'
              : '待接收'
            : entry.status === 'receiving'
              ? '接收中'
              : entry.status === 'paused'
                ? '已中断，可续传'
                : entry.status === 'done'
                  ? '已保存 ✓'
                  : `出错：${entry.error ?? ''}`;
        const actions =
          entry.status === 'done'
            ? ''
            : entry.status === 'receiving'
              ? `<button class="btn small danger" data-act="cancel" data-id="${meta.id}">取消</button>`
              : `<button class="btn small primary" data-act="accept" data-id="${meta.id}">${entry.resumable || entry.status === 'paused' ? '继续接收' : '接收'}</button>`;
        return `<li class="file-item">
          <div class="file-top">
            <span class="file-name" title="${escapeHtml(meta.path)}">${escapeHtml(meta.path)}</span>
            <span class="file-size">${formatSize(meta.size)}</span>
          </div>
          <div class="progress"><div class="progress-bar" style="width:${percent}%"></div></div>
          <div class="file-bottom">
            <span>${statusText} · ${percent}% ${speed}</span>
            <span class="actions">${actions}</span>
          </div>
        </li>`;
      })
      .join('');
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(render, 100); // 后台标签页 rAF 不触发，用定时器保证进度照常刷新
  };
  receiverHooks.set(session, { banner, schedule });
  render();
}

export function senderBannerText(state: SenderState, detail?: string): string {
  return state === 'error' ? `${senderStateText[state]}：${detail ?? ''}` : senderStateText[state];
}
export function receiverBannerText(state: ReceiverState, detail?: string): string {
  return state === 'error' ? `${receiverStateText[state]}：${detail ?? ''}` : receiverStateText[state];
}
