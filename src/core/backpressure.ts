/** DataChannel 背压：缓冲区 ≥32MB 停发，≤8MB 恢复。
 *  较高的水位让高延迟公网链路始终保持充足在途数据，填满管道。 */
export const HIGH_WATER = 32 * 1024 * 1024;
export const LOW_WATER = 8 * 1024 * 1024;

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
