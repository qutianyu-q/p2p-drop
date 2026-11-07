import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ReceiveStore } from '../src/storage/receiveStore';

describe('ReceiveStore', () => {
  let store: ReceiveStore;
  beforeEach(() => {
    store = new ReceiveStore();
  });

  it('不存在的记录返回 null', async () => {
    expect(await store.load('nope')).toBeNull();
  });

  it('保存后可读取，覆盖更新', async () => {
    await store.save('fp1', { bitmap: 'AAAA', name: 'a.bin', size: 100 });
    expect(await store.load('fp1')).toEqual({ bitmap: 'AAAA', name: 'a.bin', size: 100 });
    await store.save('fp1', { bitmap: 'BBBB', name: 'a.bin', size: 100 });
    expect((await store.load('fp1'))!.bitmap).toBe('BBBB');
  });

  it('删除与列表', async () => {
    await store.save('fp1', { bitmap: 'AAAA', name: 'a.bin', size: 100 });
    await store.save('fp2', { bitmap: 'CCCC', name: 'b.bin', size: 200 });
    const list = await store.list();
    expect(list.map((r) => r.fingerprint).sort()).toEqual(['fp1', 'fp2']);
    await store.remove('fp1');
    expect(await store.load('fp1')).toBeNull();
    expect((await store.list()).map((r) => r.fingerprint)).toEqual(['fp2']);
  });
});
