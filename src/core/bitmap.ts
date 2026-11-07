/** 接收进度位图：每块 1 bit，可序列化为 base64 用于持久化与断点续传协商 */
export class ChunkBitmap {
  private readonly bytes: Uint8Array;
  private readonly count: number;
  private received = 0;

  constructor(count: number) {
    this.count = count;
    this.bytes = new Uint8Array(Math.ceil(count / 8));
  }

  set(index: number): void {
    if (index < 0 || index >= this.count) throw new RangeError(`块序号越界: ${index}`);
    const mask = 1 << (index % 8);
    const byte = Math.floor(index / 8);
    if (this.bytes[byte] & mask) return;
    this.bytes[byte] |= mask;
    this.received++;
  }

  has(index: number): boolean {
    return (this.bytes[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
  }

  receivedCount(): number {
    return this.received;
  }

  complete(): boolean {
    return this.received === this.count;
  }

  missing(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) if (!this.has(i)) out.push(i);
    return out;
  }

  toBase64(): string {
    let binary = '';
    for (const b of this.bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }

  static fromBase64(s: string, count: number): ChunkBitmap {
    const bitmap = new ChunkBitmap(count);
    const binary = atob(s);
    for (let i = 0; i < binary.length && i < bitmap.bytes.length; i++) {
      bitmap.bytes[i] = binary.charCodeAt(i);
    }
    // 重算 received，并清掉超出 count 的尾部比特
    bitmap.received = 0;
    for (let i = 0; i < count; i++) if (bitmap.has(i)) bitmap.received++;
    return bitmap;
  }
}
