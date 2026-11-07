/** 文件分块：128 KB 数据块 + 12 字节二进制头（u32 fileId / u32 index / u32 dataLen）。
 *  含头部仍低于 Chromium 256 KiB 单消息上限；更大的块显著降低每消息开销。 */
export const CHUNK_SIZE = 128 * 1024;
const HEADER_BYTES = 12;

export function chunkCount(size: number): number {
  return Math.ceil(size / CHUNK_SIZE);
}

export function encodeChunk(fileId: number, index: number, data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + data.byteLength);
  const view = new DataView(buf);
  view.setUint32(0, fileId);
  view.setUint32(4, index);
  view.setUint32(8, data.byteLength);
  new Uint8Array(buf, HEADER_BYTES).set(data);
  return buf;
}

export function decodeChunk(buf: ArrayBuffer): { fileId: number; index: number; data: Uint8Array } {
  if (buf.byteLength < HEADER_BYTES) throw new Error('块头不完整');
  const view = new DataView(buf);
  const fileId = view.getUint32(0);
  const index = view.getUint32(4);
  const dataLen = view.getUint32(8);
  if (buf.byteLength !== HEADER_BYTES + dataLen) throw new Error('块长度不符');
  return { fileId, index, data: new Uint8Array(buf, HEADER_BYTES, dataLen) };
}

/** 文件指纹：名称+大小+最后修改时间的 djb2 哈希，用于断点续传时识别同一文件 */
export function fileFingerprint(name: string, size: number, lastModified: number): string {
  const s = `${name}:${size}:${lastModified}`;
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) + hash + s.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
