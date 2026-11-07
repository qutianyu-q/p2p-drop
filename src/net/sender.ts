import type { DataConnection } from 'peerjs';
import { CHUNK_SIZE, chunkCount, encodeChunk, fileFingerprint } from '../core/chunks';
import { Backpressure, LOW_WATER } from '../core/backpressure';
import { ChunkBitmap } from '../core/bitmap';
import { decodeMsg, encodeMsg, DATA_LANES, type ControlMessage, type FileMeta } from './protocol';
import { createRoom } from './signaling';
import type Peer from 'peerjs';

export type SenderState = 'creating' | 'waiting' | 'connected' | 'error';
export type FileStatus = 'queued' | 'sending' | 'paused' | 'sent' | 'done' | 'cancelled';

export interface SendEntry {
  meta: FileMeta;
  file: File;
  status: FileStatus;
  /** 对方已确认收到的块数 */
  acked: number;
}

export interface SenderEvents {
  onState(state: SenderState, detail?: string): void;
  onChange(): void;
}

interface PendingSend {
  bitmap: ChunkBitmap;
  started: boolean;
}

/** 发送会话：创建房间、维护文件队列、4 条并行数据通道按接收方位图补发缺失块 */
export class SenderSession {
  readonly entries: SendEntry[] = [];
  private peer: Peer;
  private control: DataConnection | null = null;
  private dataConns = new Map<string, DataConnection>();
  private dataWaiters = new Map<string, (conn: DataConnection) => void>();
  private pending = new Map<number, PendingSend>();
  private wants = new Set<number>();
  private paused = new Set<number>();
  private cancelled = new Set<number>();
  private nextId = 1;

  constructor(
    readonly code: string,
    private events: SenderEvents,
  ) {
    events.onState('creating');
    this.peer = createRoom(code, {
      onOpen: () => events.onState('waiting'),
      onControl: (conn) => this.attachControl(conn),
      onData: (conn) => this.attachData(conn),
      onError: (e) => events.onState('error', friendlyError(e)),
    });
  }

  addFiles(files: Array<{ file: File; path: string }>): FileMeta[] {
    const metas: FileMeta[] = [];
    for (const { file, path } of files) {
      const meta: FileMeta = {
        id: this.nextId++,
        name: file.name,
        path: path || file.name,
        size: file.size,
        lastModified: file.lastModified,
        fingerprint: fileFingerprint(file.name, file.size, file.lastModified),
      };
      this.entries.push({ meta, file, status: 'queued', acked: 0 });
      metas.push(meta);
    }
    this.send({ t: 'offer', files: this.entries.map((e) => e.meta) });
    this.events.onChange();
    return metas;
  }

  pauseFile(fileId: number): void {
    this.paused.add(fileId);
    const pending = this.pending.get(fileId);
    if (pending) pending.started = false; // 允许之后重新启动发送循环
    const entry = this.entry(fileId);
    if (entry && entry.status === 'sending') entry.status = 'paused';
    this.events.onChange();
  }

  resumeFile(fileId: number): void {
    this.paused.delete(fileId);
    const entry = this.entry(fileId);
    if (entry && entry.status === 'paused') {
      entry.status = 'queued';
      this.wants.add(fileId); // 重新触发发送循环
      void this.maybeStart(fileId);
    }
    this.events.onChange();
  }

  cancelFile(fileId: number): void {
    this.cancelled.add(fileId);
    const entry = this.entry(fileId);
    if (entry) entry.status = 'cancelled';
    this.send({ t: 'cancel', fileId });
    this.events.onChange();
  }

  destroy(): void {
    this.peer.destroy();
  }

  private entry(fileId: number): SendEntry | undefined {
    return this.entries.find((e) => e.meta.id === fileId);
  }

  private send(msg: ControlMessage): void {
    if (this.control?.open) this.control.send(encodeMsg(msg));
  }

  private attachControl(conn: DataConnection): void {
    this.control = conn;
    conn.on('open', () => this.events.onState('connected'));
    if (conn.open) this.events.onState('connected');
    conn.on('data', (raw) => {
      try {
        this.onMessage(decodeMsg(String(raw)));
      } catch {
        /* 忽略无法解析的对端消息 */
      }
    });
    conn.on('close', () => {
      if (this.control === conn) {
        this.control = null;
        this.events.onState('waiting');
      }
    });
  }

  private attachData(conn: DataConnection): void {
    const match = /^file-(\d+)-(\d+)$/.exec(conn.label);
    if (!match) return;
    const fileId = Number(match[1]);
    const key = `${fileId}-${match[2]}`;
    this.dataConns.set(key, conn);
    this.dataWaiters.get(key)?.(conn);
    this.dataWaiters.delete(key);
    conn.on('close', () => {
      // 任一通道断开：停止该文件所有发送循环，等待对方重连后重新 want
      this.paused.add(fileId);
      this.pending.delete(fileId);
      this.wants.delete(fileId);
      for (const k of [...this.dataConns.keys()]) {
        if (k.startsWith(`${fileId}-`)) this.dataConns.delete(k);
      }
      const entry = this.entry(fileId);
      if (entry && entry.status === 'sending') entry.status = 'queued';
      this.events.onChange();
    });
  }

  private onMessage(msg: ControlMessage): void {
    switch (msg.t) {
      case 'hello':
        this.events.onState('connected');
        this.send({ t: 'hello', role: 'sender', version: 1 });
        if (this.entries.length) this.send({ t: 'offer', files: this.entries.map((e) => e.meta) });
        break;
      case 'want': {
        // 接收方重新请求 = 明确要续传，清除此前的取消状态
        if (this.cancelled.has(msg.fileId)) {
          this.cancelled.delete(msg.fileId);
          const entry = this.entry(msg.fileId);
          if (entry && entry.status === 'cancelled') entry.status = 'queued';
        }
        this.wants.add(msg.fileId);
        void this.maybeStart(msg.fileId);
        break;
      }
      case 'resume': {
        const entry = this.entry(msg.fileId);
        if (!entry) return;
        const count = chunkCount(entry.meta.size);
        this.pending.set(msg.fileId, {
          bitmap: ChunkBitmap.fromBase64(msg.bitmap, count),
          started: false,
        });
        void this.maybeStart(msg.fileId);
        break;
      }
      case 'progress': {
        const entry = this.entry(msg.fileId);
        if (!entry) return;
        const count = chunkCount(entry.meta.size);
        const bitmap = ChunkBitmap.fromBase64(msg.bitmap, count);
        entry.acked = bitmap.receivedCount();
        // 刷新位图：用户暂停后继续时基于最新进度补发，避免大量重发
        const pending = this.pending.get(msg.fileId);
        if (pending) pending.bitmap = bitmap;
        this.events.onChange();
        break;
      }
      case 'done': {
        const entry = this.entry(msg.fileId);
        if (entry) entry.status = 'done';
        this.events.onChange();
        break;
      }
      case 'cancel': {
        const entry = this.entry(msg.fileId);
        if (entry) entry.status = 'cancelled';
        this.paused.add(msg.fileId);
        const pending = this.pending.get(msg.fileId);
        if (pending) pending.started = false;
        this.events.onChange();
        break;
      }
      default:
        break;
    }
  }

  private async maybeStart(fileId: number): Promise<void> {
    const entry = this.entry(fileId);
    const pending = this.pending.get(fileId);
    if (!entry || !pending || pending.started) return;
    if (!this.wants.has(fileId) || this.cancelled.has(fileId)) return;
    pending.started = true;
    this.paused.delete(fileId);
    entry.status = 'sending';
    entry.acked = pending.bitmap.receivedCount();
    this.events.onChange();
    try {
      const lanes = Array.from({ length: DATA_LANES }, (_, lane) => lane);
      const conns = await Promise.all(lanes.map((lane) => this.dataConn(fileId, lane)));
      // 4 条通道并行，各自按位置取模认领缺失块，突破单通道拥塞控制上限
      await Promise.all(conns.map((conn, lane) => this.sendLane(entry, conn, pending.bitmap, lane)));
      if (!this.paused.has(fileId) && !this.cancelled.has(fileId)) {
        entry.status = 'sent'; // 全部发完，等待接收方写盘完成回 done
        this.events.onChange();
      }
    } catch {
      entry.status = 'queued';
      pending.started = false;
      this.events.onChange();
    }
  }

  private dataConn(fileId: number, lane: number): Promise<DataConnection> {
    const key = `${fileId}-${lane}`;
    const existing = this.dataConns.get(key);
    if (existing?.open) return Promise.resolve(existing);
    return new Promise((resolve) => this.dataWaiters.set(key, resolve));
  }

  private async sendLane(entry: SendEntry, conn: DataConnection, bitmap: ChunkBitmap, lane: number): Promise<void> {
    const { file, meta } = entry;
    const bp = new Backpressure();
    const all = bitmap.missing();
    const missing = all.filter((_, position) => position % DATA_LANES === lane);
    // 预读下一块：磁盘 IO 与网络发送并行，避免每块都同步等待 file.read
    const readChunk = (index: number): Promise<Uint8Array> => {
      const start = index * CHUNK_SIZE;
      const slice = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
      const p = slice.arrayBuffer().then((buf) => new Uint8Array(buf));
      p.catch(() => {}); // 提前中断时避免未处理的 rejection
      return p;
    };
    let prefetch: Promise<Uint8Array> | null = missing.length ? readChunk(missing[0]) : null;
    for (let i = 0; i < missing.length; i++) {
      const index = missing[i];
      if (this.paused.has(meta.id) || this.cancelled.has(meta.id) || !conn.open) return;
      const data = await prefetch!;
      prefetch = i + 1 < missing.length ? readChunk(missing[i + 1]) : null;
      conn.send(encodeChunk(meta.id, index, data));
      if (bp.update(conn.dataChannel.bufferedAmount)) {
        while (conn.open && conn.dataChannel.bufferedAmount > LOW_WATER) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (!conn.open || this.paused.has(meta.id) || this.cancelled.has(meta.id)) return;
      }
    }
  }
}

function friendlyError(e: Error): string {
  const type = (e as Error & { type?: string }).type;
  if (type === 'unavailable-id') return '房间码被占用，请返回重新创建';
  if (type === 'network' || type === 'server-error') return '无法连接撮合服务，请检查网络后重试';
  return e.message || '连接出错';
}
