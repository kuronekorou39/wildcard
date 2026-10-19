import { describe, expect, it } from 'vitest';
import { quickAmounts } from '../src/components/ActionBar.js';

const labels = (input: Parameters<typeof quickAmounts>[0]) =>
  Object.fromEntries(quickAmounts(input).map((q) => [q.label, q.value]));

describe('レイズ額のショートカット', () => {
  it('ポットサイズはコール額を含めて計算される', () => {
    // プリフロップ: ポット30、コールに20必要、自分はまだ0
    // コールするとポットは50になり、そこにポットぶんを上乗せする
    const result = labels({ min: 40, max: 1000, pot: 30, ownBet: 0, currentBet: 20 });
    expect(result['ポット']).toBe(20 + 50);
    expect(result['1/2 ポット']).toBe(20 + 25);
    expect(result['最小']).toBe(40);
    expect(result['オールイン']).toBe(1000);
  });

  it('コールが不要なら素直にポットぶん', () => {
    const result = labels({ min: 20, max: 1000, pot: 60, ownBet: 0, currentBet: 0 });
    expect(result['ポット']).toBe(60);
    expect(result['1/2 ポット']).toBe(30);
  });

  it('下限と上限の外には出ない', () => {
    for (const q of quickAmounts({ min: 40, max: 60, pot: 500, ownBet: 0, currentBet: 20 })) {
      expect(q.value).toBeGreaterThanOrEqual(40);
      expect(q.value).toBeLessThanOrEqual(60);
    }
  });

  it('同じ額になった候補は畳まれる', () => {
    // 手持ちが少なく、すべてオールインに丸まる場合
    const result = quickAmounts({ min: 40, max: 40, pot: 500, ownBet: 0, currentBet: 20 });
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe(40);
  });
});
