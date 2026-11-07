import { describe, it, expect } from 'vitest';
import { encodeMsg, decodeMsg, type ControlMessage, type FileMeta } from '../src/net/protocol';

const meta: FileMeta = {
  id: 1,
  name: '视频.mp4',
  path: '旅行/视频.mp4',
  size: 123456789,
  lastModified: 1700000000000,
  fingerprint: 'abc123',
};

const messages: ControlMessage[] = [
  { t: 'hello', role: 'sender', version: 1 },
  { t: 'hello', role: 'receiver', version: 1 },
  { t: 'offer', files: [meta] },
  { t: 'resume', fileId: 1, bitmap: 'AAAA' },
  { t: 'want', fileId: 1 },
  { t: 'progress', fileId: 1, bitmap: 'AAAA' },
  { t: 'done', fileId: 1 },
  { t: 'pause', fileId: 1 },
  { t: 'cancel', fileId: 1 },
  { t: 'error', message: '出错了' },
];

describe('protocol', () => {
  it('所有消息类型编码解码往返一致', () => {
    for (const m of messages) {
      expect(decodeMsg(encodeMsg(m))).toEqual(m);
    }
  });

  it('非法输入抛错', () => {
    expect(() => decodeMsg('not json')).toThrow();
    expect(() => decodeMsg('{"t":"nope"}')).toThrow();
    expect(() => decodeMsg('{}')).toThrow();
  });
});
