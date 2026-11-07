/** DataChannel 背压：缓冲区 ≥16MB 停发，≤4MB 恢复，防止大文件撑爆内存 */
export const HIGH_WATER = 16 * 1024 * 1024;
export const LOW_WATER = 4 * 1024 * 1024;

export class Backpressure {
  private blocked = false;

  /** 传入当前 bufferedAmount，返回是否应暂停发送 */
  update(bufferedAmount: number): boolean {
    if (!this.blocked && bufferedAmount >= HIGH_WATER) this.blocked = true;
    else if (this.blocked && bufferedAmount <= LOW_WATER) this.blocked = false;
    return this.blocked;
  }
}

/** 等到通道缓冲区降到低水位以下 */
export async function waitForDrain(dc: { bufferedAmount: number }): Promise<void> {
  while (dc.bufferedAmount > LOW_WATER) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
