import { describe, it, expect } from 'vitest';
import { ChunkBitmap } from '../src/core/bitmap';

describe('ChunkBitmap', () => {
  it('新位图全缺、不完整', () => {
    const b = new ChunkBitmap(10);
    expect(b.receivedCount()).toBe(0);
    expect(b.complete()).toBe(false);
    expect(b.missing()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('零块文件直接完整', () => {
    expect(new ChunkBitmap(0).complete()).toBe(true);
  });

  it('set/has/receivedCount/missing', () => {
    const b = new ChunkBitmap(5);
    b.set(0);
    b.set(2);
    b.set(4);
    expect(b.has(2)).toBe(true);
    expect(b.has(1)).toBe(false);
    expect(b.receivedCount()).toBe(3);
    expect(b.missing()).toEqual([1, 3]);
    expect(b.complete()).toBe(false);
    b.set(1);
    b.set(3);
    expect(b.complete()).toBe(true);
  });

  it('base64 往返（含 1000 块随机）', () => {
    const b = new ChunkBitmap(1000);
    for (let i = 0; i < 1000; i++) if (Math.random() < 0.5) b.set(i);
    const restored = ChunkBitmap.fromBase64(b.toBase64(), 1000);
    expect(restored.receivedCount()).toBe(b.receivedCount());
    expect(restored.missing()).toEqual(b.missing());
  });

  it('重复 set 不重复计数', () => {
    const b = new ChunkBitmap(3);
    b.set(1);
    b.set(1);
    expect(b.receivedCount()).toBe(1);
  });
});
