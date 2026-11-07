import { describe, it, expect } from 'vitest';
import { Backpressure, HIGH_WATER, LOW_WATER } from '../src/core/backpressure';

describe('Backpressure', () => {
  it('高低水位状态机', () => {
    const bp = new Backpressure();
    expect(bp.update(0)).toBe(false);
    expect(bp.update(HIGH_WATER - 1)).toBe(false);
    expect(bp.update(HIGH_WATER)).toBe(true); // 到达高水位，暂停
    expect(bp.update(16 * 1024 * 1024)).toBe(true); // 中间保持暂停
    expect(bp.update(LOW_WATER + 1)).toBe(true);
    expect(bp.update(LOW_WATER)).toBe(false); // 降到低水位，恢复
    expect(bp.update(HIGH_WATER)).toBe(true); // 再次触发
  });

  it('水位常量符合设计（单通道 8/2MB，4 通道合计约 32MB）', () => {
    expect(HIGH_WATER).toBe(8 * 1024 * 1024);
    expect(LOW_WATER).toBe(2 * 1024 * 1024);
  });
});
