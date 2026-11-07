import { describe, it, expect } from 'vitest';
import { generateRoomCode, normalizeRoomCode, isValidRoomCode } from '../src/core/roomCode';

describe('roomCode', () => {
  it('生成 6 位合法房间码', () => {
    for (let i = 0; i < 100; i++) {
      const c = generateRoomCode();
      expect(c).toHaveLength(6);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });

  it('拒绝易混淆字符与非法长度', () => {
    expect(isValidRoomCode('ABCD0O')).toBe(false);
    expect(isValidRoomCode('ABCD1I')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  it('规范化小写与空白、连字符', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeRoomCode('ABCDEF')).toBe('ABCDEF');
  });
});
