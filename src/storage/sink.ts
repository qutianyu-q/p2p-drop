import type { FileMeta } from '../net/protocol';

export interface FileSink {
  write(offset: number, data: Uint8Array): Promise<void>;
  finalize(): Promise<void>;
  abort(): Promise<void>;
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
  }) => Promise<{
    createWritable(): Promise<{
      write(data: { type: 'write'; position: number; data: Uint8Array }): Promise<void>;
      close(): Promise<void>;
      abort?(): Promise<void>;
    }>;
  }>;
};

/** Chromium：直接写用户选定的位置，不占内存 */
async function createFsAccessSink(meta: FileMeta): Promise<FileSink> {
  const handle = await (window as SaveFilePickerWindow).showSaveFilePicker!({
    suggestedName: meta.name,
  });
  const writable = await handle.createWritable();
  return {
    async write(offset, data) {
      await writable.write({ type: 'write', position: offset, data: data as Uint8Array<ArrayBuffer> });
    },
    async finalize() {
      await writable.close();
    },
    async abort() {
      try {
        await writable.abort?.();
      } catch {
        /* 忽略中止异常 */
      }
    },
  };
}

/** Firefox / Safari 兜底：写 OPFS，完成后触发浏览器下载导出 */
async function createOpfsSink(meta: FileMeta): Promise<FileSink> {
  const dir = await navigator.storage.getDirectory();
  const fileName = `p2p-${meta.fingerprint}-${meta.name}`;
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: true });
  return {
    async write(offset, data) {
      await writable.write({ type: 'write', position: offset, data: data as Uint8Array<ArrayBuffer> });
    },
    async finalize() {
      await writable.close();
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      await dir.removeEntry(fileName);
    },
    async abort() {
      try {
        await writable.close();
        await dir.removeEntry(fileName);
      } catch {
        /* 忽略中止异常 */
      }
    },
  };
}

export async function createSink(meta: FileMeta): Promise<{ sink: FileSink; mode: 'fs-access' | 'opfs' }> {
  if (typeof (window as SaveFilePickerWindow).showSaveFilePicker === 'function') {
    return { sink: await createFsAccessSink(meta), mode: 'fs-access' };
  }
  return { sink: await createOpfsSink(meta), mode: 'opfs' };
}
