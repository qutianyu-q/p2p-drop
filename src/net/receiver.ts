import type { DataConnection } from 'peerjs';
import type Peer from 'peerjs';
import { CHUNK_SIZE, chunkCount, decodeChunk } from '../core/chunks';
import { ChunkBitmap } from '../core/bitmap';
import { decodeMsg, encodeMsg, type ControlMessage, type FileMeta } from './protocol';
import { joinRoom, openDataChannel } from './signaling';
import { ReceiveStore } from '../storage/receiveStore';
import { createSink, type FileSink } from '../storage/sink';

export type ReceiverState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ReceiveEntry {
  meta: FileMeta;
  status: 'idle' | 'receiving' | 'paused' | 'done' | 'error';
  received: number;
  /** 本地有未完成进度（可续传） */
  resumable: boolean;
  error?: string;
}

export interface ReceiverEvents {
  onState(state: ReceiverState, detail?: string): void;
  onChange(): void;
}

interface ActiveReceive {
  bitmap: ChunkBitmap;
  sink: FileSink;
  writeChain: Promise<void>;
  lastReport: number;
  cancelled: boolean;
}

/** 接收会话：加入房间、落盘、位图回执、断点续传 */
export class ReceiverSession {
  readonly entries: ReceiveEntry[] = [];
  private peer: Peer | null = null;
  private control: DataConnection | null = null;
  private active = new Map<number, ActiveReceive>();
  private store = new ReceiveStore();

  private constructor(
    readonly code: string,
    private events: ReceiverEvents,
  ) {}

  static async join(code: string, events: ReceiverEvents): Promise<ReceiverSession> {
    const session = new ReceiverSession(code, events);
    events.onState('connecting');
    const { peer, control } = await joinRoom(code);
    session.peer = peer;
    session.attachControl(control);
    return session;
  }

  /** 接收（或续传）某个文件 */
  async accept(fileId: number): Promise<void> {
    const entry = this.entries.find((e) => e.meta.id === fileId);
    if (!entry || entry.status === 'receiving' || entry.status === 'done') return;
    const { meta } = entry;
    const count = chunkCount(meta.size);
    try {
      const saved = await this.store.load(meta.fingerprint);
      const bitmap = saved ? ChunkBitmap.fromBase64(saved.bitmap, count) : new ChunkBitmap(count);
      const { sink } = await createSink(meta);
      const active: ActiveReceive = {
        bitmap,
        sink,
        writeChain: Promise.resolve(),
        lastReport: 0,
        cancelled: false,
      };
      this.active.set(fileId, active);
      entry.status = 'receiving';
      entry.received = bitmap.receivedCount();
      entry.resumable = false;
      this.events.onChange();

      if (bitmap.complete()) {
        await this.finish(fileId);
        return;
      }

      const conn = await openDataChannel(this.peer!, this.code, fileId);
      conn.on('data', (raw) => this.onChunk(fileId, raw));
      conn.on('close', () => {
        // 数据通道断开：位图已持久化，等用户重新接收即续传
        const current = this.entries.find((e) => e.meta.id === fileId);
        if (current && current.status === 'receiving') {
          current.status = 'paused';
          current.resumable = true;
          this.active.delete(fileId);
          this.events.onChange();
        }
      });
      this.send({ t: 'want', fileId });
      this.send({ t: 'resume', fileId, bitmap: bitmap.toBase64() });
    } catch (e) {
      entry.status = 'error';
      entry.error = e instanceof Error ? e.message : String(e);
      this.active.delete(fileId);
      this.events.onChange();
    }
  }

  cancel(fileId: number): void {
    const active = this.active.get(fileId);
    if (active) active.cancelled = true;
    const entry = this.entries.find((e) => e.meta.id === fileId);
    if (entry) entry.status = 'paused';
    this.active.delete(fileId);
    this.send({ t: 'cancel', fileId });
    this.events.onChange();
  }

  destroy(): void {
    this.peer?.destroy();
  }

  private send(msg: ControlMessage): void {
    if (this.control?.open) this.control.send(encodeMsg(msg));
  }

  private attachControl(conn: DataConnection): void {
    this.control = conn;
    conn.on('open', () => {
      this.events.onState('connected');
      this.send({ t: 'hello', role: 'receiver', version: 1 });
    });
    conn.on('data', (raw) => {
      try {
        this.onMessage(decodeMsg(String(raw)));
      } catch {
        /* 忽略无法解析的对端消息 */
      }
    });
    conn.on('close', () => {
      this.events.onState('disconnected');
      for (const entry of this.entries) {
        if (entry.status === 'receiving') {
          entry.status = 'paused';
          entry.resumable = true;
        }
      }
      this.active.clear();
      this.events.onChange();
    });
  }

  private async onMessage(msg: ControlMessage): Promise<void> {
    if (msg.t === 'offer') {
      const known = new Set(this.entries.map((e) => e.meta.id));
      for (const meta of msg.files) {
        if (known.has(meta.id)) continue;
        const saved = await this.store.load(meta.fingerprint);
        this.entries.push({ meta, status: 'idle', received: 0, resumable: saved !== null });
      }
      this.events.onChange();
    } else if (msg.t === 'error') {
      this.events.onState('error', msg.message);
    }
  }

  private onChunk(fileId: number, raw: unknown): void {
    const active = this.active.get(fileId);
    const entry = this.entries.find((e) => e.meta.id === fileId);
    if (!active || !entry || active.cancelled) return;
    const buf = raw instanceof ArrayBuffer ? raw : (raw as { buffer?: ArrayBuffer })?.buffer;
    if (!(buf instanceof ArrayBuffer)) return;
    const { index, data } = decodeChunk(buf);
    if (active.bitmap.has(index)) return; // 重复块直接丢弃
    active.bitmap.set(index);
    entry.received = active.bitmap.receivedCount();
    // 写盘串行化，避免同一文件句柄并发写
    active.writeChain = active.writeChain.then(() => active.sink.write(index * CHUNK_SIZE, data));
    const now = Date.now();
    if (now - active.lastReport > 500 || active.bitmap.complete()) {
      active.lastReport = now;
      this.send({ t: 'progress', fileId, bitmap: active.bitmap.toBase64() });
      void this.store.save(entry.meta.fingerprint, {
        bitmap: active.bitmap.toBase64(),
        name: entry.meta.name,
        size: entry.meta.size,
      });
    }
    this.events.onChange();
    if (active.bitmap.complete()) {
      void active.writeChain.then(() => this.finish(fileId));
    }
  }

  private async finish(fileId: number): Promise<void> {
    const active = this.active.get(fileId);
    const entry = this.entries.find((e) => e.meta.id === fileId);
    if (!active || !entry) return;
    await active.sink.finalize();
    await this.store.remove(entry.meta.fingerprint);
    entry.status = 'done';
    entry.resumable = false;
    this.active.delete(fileId);
    this.send({ t: 'done', fileId });
    this.events.onChange();
  }
}
