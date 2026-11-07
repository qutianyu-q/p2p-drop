import { describe, it, expect } from 'vitest';
import { CHUNK_SIZE, chunkCount, encodeChunk, decodeChunk, fileFingerprint } from '../src/core/chunks';

describe('chunks', () => {
  it('块大小为 128 KB，且含头部低于 256 KiB 消息上限', () => {
    expect(CHUNK_SIZE).toBe(128 * 1024);
    expect(CHUNK_SIZE + 12).toBeLessThanOrEqual(256 * 1024);
  });

  it('计算块数', () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(CHUNK_SIZE)).toBe(1);
    expect(chunkCount(CHUNK_SIZE + 1)).toBe(2);
    expect(chunkCount(10_000_000_000)).toBe(Math.ceil(10_000_000_000 / CHUNK_SIZE));
  });

  it('块编解码往返一致', () => {
    const data = new Uint8Array([1, 2, 3, 250, 255]);
    const buf = encodeChunk(7, 42, data);
    const decoded = decodeChunk(buf);
    expect(decoded.fileId).toBe(7);
    expect(decoded.index).toBe(42);
    expect(Array.from(decoded.data)).toEqual([1, 2, 3, 250, 255]);
  });

  it('支持大块序号（几十 GB 文件）', () => {
    const buf = encodeChunk(1, 500000, new Uint8Array(0));
    expect(decodeChunk(buf).index).toBe(500000);
  });

  it('指纹对大小与修改时间敏感', () => {
    const a = fileFingerprint('a.bin', 100, 1700000000000);
    expect(a).toBe(fileFingerprint('a.bin', 100, 1700000000000));
    expect(a).not.toBe(fileFingerprint('a.bin', 101, 1700000000000));
    expect(a).not.toBe(fileFingerprint('a.bin', 100, 1700000000001));
    expect(a).not.toBe(fileFingerprint('b.bin', 100, 1700000000000));
  });
});
