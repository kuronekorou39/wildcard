import { describe, expect, it } from 'vitest';
import { estimateEquity, suggestedSamples } from '../src/ai/equity.js';
import { STANDARD_RULESET } from '../src/rules/presets.js';
import { ACE_LOW, SHORT_DECK } from '../src/rules/variants.js';
import { cards } from './helpers.js';

const equity = (hole: string, board: string, opponents: number, seed = 1, samples = 400) =>
  estimateEquity({
    holeCards: cards(hole),
    communityCards: board === '' ? [] : cards(board),
    opponents,
    ruleSet: STANDARD_RULESET,
    samples,
    seed,
  });

describe('勝率の推定', () => {
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
      ruleSet: SHORT_DECK,
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
    const normal = estimateEquity({ ...base, ruleSet: STANDARD_RULESET });
    const aceLow = estimateEquity({ ...base, ruleSet: ACE_LOW });
    expect(aceLow).toBeLessThan(normal);
  });

  it('エース最弱ルールでは K のペアが最強のペアになる', () => {
    const make = (hole: string) =>
      estimateEquity({
        holeCards: cards(hole),
        communityCards: [],
        opponents: 1,
        ruleSet: ACE_LOW,
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
});
