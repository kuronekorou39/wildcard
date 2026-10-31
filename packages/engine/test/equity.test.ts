import { describe, expect, it } from 'vitest';
import { estimateEquity, suggestedSamples } from '../src/ai/equity.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { ACE_LOW, SHORT_DECK } from '../src/rules/variants.js';
import { cards } from './helpers.js';

const equity = (hole: string, board: string, opponents: number, seed = 1, samples = 400) =>
  estimateEquity({
    holeCards: cards(hole),
    communityCards: board === '' ? [] : cards(board),
    opponents,
    variant: STANDARD_VARIANT,
    samples,
    seed,
  });

describe('勝率の推定', () => {
  it('known cards remove only their physical copies from a duplicate deck', () => {
    const deck = cards('As Ks Qs Js Ts 2h 3d');
    const variant = { ...STANDARD_VARIANT, deck: { ...STANDARD_VARIANT.deck, copies: 0,
      overrides: deck.map(card => ({ ...card, count: card.rank === 'A' || card.rank === 'K' ? 2 : 1 })) } };
    expect(estimateEquity({ holeCards: cards('As Ks'), communityCards: cards('Qs Js Ts 2h 3d'), opponents: 1,
      variant, samples: 5, seed: 1 })).toBe(0.5);
  });
  it('同じ seed からは同じ結果になる', () => {
    expect(equity('As Ah', '', 1)).toBe(equity('As Ah', '', 1));
  });

  it('AA はヘッズアップで非常に強い', () => {
    // 実際のAAの勝率は約85%。推定なので幅を持たせる。
    expect(equity('As Ah', '', 1)).toBeGreaterThan(0.78);
    expect(equity('As Ah', '', 1)).toBeLessThan(0.93);
  });

  it('72オフスートはヘッズアップで弱い', () => {
    // 実際は約35%。
    expect(equity('7s 2h', '', 1)).toBeGreaterThan(0.25);
    expect(equity('7s 2h', '', 1)).toBeLessThan(0.45);
  });

  it('AA は 72 より強い', () => {
    expect(equity('As Ah', '', 1)).toBeGreaterThan(equity('7s 2h', '', 1));
  });

  it('相手が増えるほど勝率は下がる', () => {
    const one = equity('As Ah', '', 1);
    const three = equity('As Ah', '', 3);
    const five = equity('As Ah', '', 5);
    expect(three).toBeLessThan(one);
    expect(five).toBeLessThan(three);
  });

  it('リバーで負けようがない手は勝率1', () => {
    // ボードにロイヤルの4枚、自分が残り1枚を持っている
    expect(equity('As Ks', 'Qs Js Ts 2h 3d', 1, 1, 60)).toBe(1);
    expect(equity('As Ks', 'Qs Js Ts 2h 3d', 4, 1, 60)).toBe(1);
  });

  it('リバーで勝ちようがない手は勝率0に近い', () => {
    // ボードにストレートフラッシュが完成していて自分は絡めない
    const value = equity('2h 3d', '5s 6s 7s 8s 9s '.trim(), 1, 1, 120);
    // 相手も同じボードを使うのでチョップが多い。勝つことはない。
    expect(value).toBeLessThan(0.6);
  });

  it('場が全部開いていれば未来の札に左右されない', () => {
    const a = equity('As Ah', 'Kd 7c 2s 9h 4d', 1, 1, 200);
    const b = equity('As Ah', 'Kd 7c 2s 9h 4d', 1, 999, 200);
    // 相手の手札だけが変数なので、seed が違っても近い値に収まる
    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });

  it('相手がいなければ必ず勝ち', () => {
    expect(equity('7s 2h', '', 0)).toBe(1);
  });

  it('試行回数が0以下なら0を返す', () => {
    expect(equity('As Ah', '', 1, 1, 0)).toBe(0);
  });
});

describe('ルールが変われば勝率も変わる', () => {
  const shortDeck = (hole: string, opponents: number) =>
    estimateEquity({
      holeCards: cards(hole),
      communityCards: [],
      opponents,
      variant: SHORT_DECK,
      samples: 400,
      seed: 5,
    });

  it('ショートデッキでも推定できる', () => {
    const value = shortDeck('As Ah', 1);
    expect(value).toBeGreaterThan(0.6);
    expect(value).toBeLessThan(0.95);
  });

  it('エース最弱ルールでは A のペアが弱くなる', () => {
    const base = {
      holeCards: cards('As Ah'),
      communityCards: [],
      opponents: 1,
      samples: 400,
      seed: 11,
    };
    const normal = estimateEquity({ ...base, variant: STANDARD_VARIANT });
    const aceLow = estimateEquity({ ...base, variant: ACE_LOW });
    expect(aceLow).toBeLessThan(normal);
  });

  it('エース最弱ルールでは K のペアが最強のペアになる', () => {
    const make = (hole: string) =>
      estimateEquity({
        holeCards: cards(hole),
        communityCards: [],
        opponents: 1,
        variant: ACE_LOW,
        samples: 400,
        seed: 13,
      });
    expect(make('Ks Kh')).toBeGreaterThan(make('As Ah'));
  });
});

describe('試行回数の目安', () => {
  it('ボードが揃うほど減る', () => {
    expect(suggestedSamples(0, 1)).toBeGreaterThan(suggestedSamples(5, 1));
  });

  it('相手が増えるほど減る（1試行が重くなるため）', () => {
    expect(suggestedSamples(0, 1)).toBeGreaterThan(suggestedSamples(0, 5));
  });

  it('下限を割らない', () => {
    expect(suggestedSamples(5, 9)).toBeGreaterThanOrEqual(60);
  });

  it('1手の評価が重いルールでは、全体の計算量が収まるまで試行を削る', () => {
    // 手札10枚・場20枚（役5枚）は 1手 142,506 通り。標準の 21 通りと同じ回数は回せない。
    expect(suggestedSamples(0, 1, 142_506)).toBeLessThan(suggestedSamples(0, 1));
    expect(suggestedSamples(0, 1, 142_506)).toBeGreaterThanOrEqual(6);
    // 標準・オマハ（60通り）の範囲では今までどおり。
    expect(suggestedSamples(0, 1, 60)).toBe(suggestedSamples(0, 1));
    expect(suggestedSamples(5, 9, 60)).toBe(suggestedSamples(5, 9));
  });
});
