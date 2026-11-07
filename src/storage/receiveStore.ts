import { openDB, type IDBPDatabase } from 'idb';

export interface ReceiveRecord {
  bitmap: string;
  name: string;
  size: number;
}

interface StoredRecord extends ReceiveRecord {
  fingerprint: string;
}

/** 接收进度持久化：IndexedDB，刷新/重开浏览器后按文件指纹找回位图 */
export class ReceiveStore {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private db(): Promise<IDBPDatabase> {
    this.dbPromise ??= openDB('p2p-receive', 1, {
      upgrade(db) {
        db.createObjectStore('files', { keyPath: 'fingerprint' });
      },
    });
    return this.dbPromise;
  }

  async load(fingerprint: string): Promise<ReceiveRecord | null> {
    const db = await this.db();
    const rec = (await db.get('files', fingerprint)) as StoredRecord | undefined;
    if (!rec) return null;
    return { bitmap: rec.bitmap, name: rec.name, size: rec.size };
  }

  async save(fingerprint: string, rec: ReceiveRecord): Promise<void> {
    const db = await this.db();
    await db.put('files', { ...rec, fingerprint } satisfies StoredRecord);
  }

  async remove(fingerprint: string): Promise<void> {
    const db = await this.db();
    await db.delete('files', fingerprint);
  }

  async list(): Promise<StoredRecord[]> {
    const db = await this.db();
    return (await db.getAll('files')) as StoredRecord[];
  }
}
