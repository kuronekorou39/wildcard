import { describe, expect, it } from 'vitest';
import { raiseScale } from '../src/raiseScale.js';

describe('レイズのスライダー', () => {
  it('BB20・上限1000では中央を200にして小さいベットを細かく選ぶ', () => {
    const scale = raiseScale(20, 1000, 20);
    expect([0, 250, 500, 750, 1000].map(p => scale.amountAt(p))).toEqual([20, 110, 200, 600, 1000]);
    expect(raiseScale(40, 1000, 20).amountAt(500)).toBe(200);
  });
  it('短いスタック・ポットリミット・大きなレイズでも整数の合法範囲を守る', () => {
    for (const [min, max, bb] of [[40, 70, 20], [40, 40, 20], [1000, 10000, 20], [20, 1e12, 20]]) {
      const scale = raiseScale(min!, max!, bb!);
      const amounts = Array.from({ length: 1001 }, (_, p) => scale.amountAt(p));
      expect(amounts[0]).toBe(min); expect(amounts.at(-1)).toBe(max);
      expect(amounts.every((n, i) => Number.isSafeInteger(n) && n >= min! && n <= max! && (i === 0 || n >= amounts[i - 1]!))).toBe(true);
      expect(scale.amountAt(-1)).toBe(min); expect(scale.amountAt(1001)).toBe(max);
      for (const n of [min!, min! + Math.floor((max! - min!) / 3), max!]) expect(scale.amountAt(scale.positionOf(n))).toBeCloseTo(n, 0);
    }
  });
});
