import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_LENGTH,
  createRoomCode,
  invalidRoomCodeChars,
  isValidRoomCode,
  normalizeRoomCode,
} from '../src/room.js';

describe('ルームコード', () => {
  it('生成したコードは必ず有効', () => {
    for (let i = 0; i < 200; i++) {
      const code = createRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('見間違えやすい文字を使わない', () => {
    const generated = Array.from({ length: 300 }, createRoomCode).join('');
    for (const bad of ['O', 'I', 'L', '0', '1']) {
      expect(generated, `${bad} が混ざっている`).not.toContain(bad);
    }
  });

  it('小文字と区切り文字を吸収する', () => {
    expect(normalizeRoomCode('abc-def')).toBe('ABCDEF');
    expect(normalizeRoomCode(' a b c d e f ')).toBe('ABCDEF');
  });

  it('長すぎる入力は切り詰める', () => {
    expect(normalizeRoomCode('ABCDEFGHIJ')).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('使わない文字を勝手に別の文字へ寄せない', () => {
    // O を Q に、I を J に推測で置き換えると、正しいコードまで壊してしまう。
    // 正規化は大文字化と区切り除去だけに留め、あとは検証で弾く。
    expect(normalizeRoomCode('OIL123')).toBe('OIL123');
    expect(isValidRoomCode('OIL123')).toBe(false);
  });

  it('使われていない文字を指摘できる', () => {
    expect(invalidRoomCodeChars('ABCOID').sort()).toEqual(['I', 'O']);
    expect(invalidRoomCodeChars('ABCDEF')).toEqual([]);
  });

  it('長さが足りないコードは無効', () => {
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });
});
