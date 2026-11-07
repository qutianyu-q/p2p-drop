/** 控制通道消息：JSON 编码的判别联合 */
export interface FileMeta {
  id: number;
  name: string;
  /** 相对路径（文件夹传输时含目录），单文件时等于 name */
  path: string;
  size: number;
  lastModified: number;
  fingerprint: string;
}

export type ControlMessage =
  | { t: 'hello'; role: 'sender' | 'receiver'; version: 1 }
  | { t: 'offer'; files: FileMeta[] }
  | { t: 'resume'; fileId: number; bitmap: string }
  | { t: 'want'; fileId: number }
  | { t: 'progress'; fileId: number; bitmap: string }
  | { t: 'done'; fileId: number }
  | { t: 'pause'; fileId: number }
  | { t: 'cancel'; fileId: number }
  | { t: 'error'; message: string };

const MESSAGE_TYPES = new Set(['hello', 'offer', 'resume', 'want', 'progress', 'done', 'pause', 'cancel', 'error']);

export function encodeMsg(m: ControlMessage): string {
  return JSON.stringify(m);
}

export function decodeMsg(s: string): ControlMessage {
  const parsed = JSON.parse(s) as { t?: unknown };
  if (typeof parsed?.t !== 'string' || !MESSAGE_TYPES.has(parsed.t)) {
    throw new Error(`非法控制消息: ${s.slice(0, 100)}`);
  }
  return parsed as ControlMessage;
}
