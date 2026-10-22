import { describe, expect, it } from 'vitest';
import { quickAmounts } from '../src/components/ActionBar.js';

const labels = (input: Parameters<typeof quickAmounts>[0]) =>
  Object.fromEntries(quickAmounts(input).map((q) => [q.label, q.value]));

describe('レイズ額のショートカット', () => {
  it('ポットサイズはコール額を含めて計算される', () => {
    // プリフロップ: ポット30、コールに20必要、自分はまだ0
    // コールするとポットは50になり、そこにポットぶんを上乗せする
    const result = labels({ min: 40, max: 1000, pot: 30, ownBet: 0, currentBet: 20, allIn: 1000 });
    expect(result['ポット']).toBe(20 + 50);
    expect(result['1/2 ポット']).toBe(20 + 25);
    expect(result['最小']).toBe(40);
    expect(result['オールイン']).toBe(1000);
  });

  it('コールが不要なら素直にポットぶん', () => {
    const result = labels({ min: 20, max: 1000, pot: 60, ownBet: 0, currentBet: 0, allIn: 1000 });
    expect(result['ポット']).toBe(60);
    expect(result['1/2 ポット']).toBe(30);
  });

  it('下限と上限の外には出ない', () => {
    for (const q of quickAmounts({ min: 40, max: 60, pot: 500, ownBet: 0, currentBet: 20, allIn: 60 })) {
      expect(q.value).toBeGreaterThanOrEqual(40);
      expect(q.value).toBeLessThanOrEqual(60);
    }
  });

  it('ポットの分数を含む6候補を金額の小さい順に並べる', () => {
    const result = quickAmounts({ min: 20, max: 1000, pot: 120, ownBet: 0, currentBet: 0, allIn: 1000 });
    expect(result).toEqual([
      { label: '最小', value: 20 },
      { label: '1/3 ポット', value: 40 },
      { label: '1/2 ポット', value: 60 },
      { label: '3/4 ポット', value: 90 },
      { label: 'ポット', value: 120 },
      { label: 'オールイン', value: 1000 },
    ]);
  });

  it('ポット額と上限が一致しても、最後の候補は上限とわかる', () => {
    const result = quickAmounts({ min: 40, max: 70, pot: 30, ownBet: 0, currentBet: 20, allIn: 1000 });
    expect(result.at(-1)).toEqual({ label: '上限', value: 70 });
    expect(new Set(result.map(q => q.value)).size).toBe(result.length);
  });

  it('上限が手持ち全部でなければ「オールイン」と書かない', () => {
    // ポットリミットや「オールイン禁止」では、上限はオールインではない。
    // ここで嘘のラベルを出すと、押した人が全部入れたつもりになる。
    const capped = labels({ min: 40, max: 999, pot: 30, ownBet: 0, currentBet: 20, allIn: 1000 });
    expect(capped['上限']).toBe(999);
    expect(capped['オールイン']).toBeUndefined();

    const full = labels({ min: 40, max: 1000, pot: 30, ownBet: 0, currentBet: 20, allIn: 1000 });
    expect(full['オールイン']).toBe(1000);
    expect(full['上限']).toBeUndefined();
  });

  it('同じ額になった候補は畳まれる', () => {
    // 手持ちが少なく、すべてオールインに丸まる場合
    const result = quickAmounts({ min: 40, max: 40, pot: 500, ownBet: 0, currentBet: 20, allIn: 40 });
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe(40);
  });
});
