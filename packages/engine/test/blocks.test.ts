import { describe, expect, it } from 'vitest';
import { blockSize, describeBlock, fromBlocks, toBlocks } from '../src/rules/blocks.js';
import { describePattern } from '../src/rules/example.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { VARIANT_PRESETS } from '../src/rules/variants.js';
import type { HandPattern } from '../src/types.js';

const patternOf = (variantId: string, rankingId: string): HandPattern =>
  VARIANT_PRESETS.find((v) => v.id === variantId)!.ranking.hands.find((h) => h.id === rankingId)!
    .pattern;

describe('まとまりへの行き帰り', () => {
  it('どのプリセットの役も、戻すと元に戻る', () => {
    // ここが崩れると「編集画面を開いて閉じただけで役が変わる」ことになる。
    for (const variant of VARIANT_PRESETS) {
      for (const hand of variant.ranking.hands) {
        const blocks = toBlocks(hand.pattern);
        expect(blocks, `${variant.name} / ${hand.name}: まとまりにできない`).not.toBeNull();
        expect(fromBlocks(blocks!, hand.pattern.global), `${variant.name} / ${hand.name}`).toEqual(
          hand.pattern,
        );
      }
    }
  });

  it('よく知られた役が見たとおりのまとまりになる', () => {
    expect(toBlocks(patternOf('standard', 'full_house'))).toEqual([
      { kind: 'sameRank', count: 3 },
      { kind: 'sameRank', count: 2 },
    ]);
    expect(toBlocks(patternOf('standard', 'straight'))).toEqual([{ kind: 'run', count: 5 }]);
    expect(toBlocks(patternOf('standard', 'flush'))).toEqual([{ kind: 'any', count: 5 }]);
    expect(toBlocks(patternOf('standard', 'royal_flush'))).toEqual([
      { kind: 'fixed', ranks: ['10', 'J', 'Q', 'K', 'A'] },
    ]);
    expect(toBlocks(patternOf('house-hands', 'pair_plus_run'))).toEqual([
      { kind: 'sameRank', count: 2 },
      { kind: 'run', count: 3 },
    ]);
    expect(toBlocks(patternOf('prime', 'prime'))).toEqual([
      { kind: 'oneOf', ranks: ['2', '3', '5', '7', 'J', 'K'], count: 5 },
    ]);
  });

  it('変数名は画面に出さずに振られる', () => {
    // 作る側は「3枚組と2枚組」としか言っていない。X や Y は結果でしかない。
    const pattern = fromBlocks([
      { kind: 'sameRank', count: 3 },
      { kind: 'sameRank', count: 2 },
    ]);
    expect(pattern).toEqual(patternOf('standard', 'full_house'));
  });

  it('連続の offset は 0 を書かない', () => {
    // 判定は同じだが、書き出した JSON がプリセットと食い違う。
    const pattern = fromBlocks([{ kind: 'run', count: 3 }]);
    expect(pattern.cards[0]!.rank).toEqual({ type: 'variable', name: 'X' });
    expect(pattern.cards[1]!.rank).toEqual({ type: 'variable', name: 'X', offset: 1 });
  });
});

describe('まとまりで表せない形', () => {
  it('1枚ずつスートを指定した役', () => {
    const pattern: HandPattern = {
      cards: [{ rank: { type: 'any' }, suits: ['spades'] }],
      global: [],
    };
    expect(toBlocks(pattern)).toBeNull();
  });

  it('飛び石の相対指定', () => {
    // X, X+2 は作れるが、「連続する」でも「同じランク」でもない。
    const pattern: HandPattern = {
      cards: [
        { rank: { type: 'variable', name: 'X' }, suits: [] },
        { rank: { type: 'variable', name: 'X', offset: 2 }, suits: [] },
      ],
      global: [],
    };
    expect(toBlocks(pattern)).toBeNull();
  });

  it('同じ変数が離れて現れる形', () => {
    const pattern: HandPattern = {
      cards: [
        { rank: { type: 'variable', name: 'X' }, suits: [] },
        { rank: { type: 'any' }, suits: [] },
        { rank: { type: 'variable', name: 'X' }, suits: [] },
      ],
      global: [],
    };
    expect(toBlocks(pattern)).toBeNull();
  });
});

describe('まとまりの説明', () => {
  it('まとまりごとの言い方', () => {
    expect(describeBlock({ kind: 'sameRank', count: 3 })).toBe('同じランクが3枚');
    expect(describeBlock({ kind: 'run', count: 5 })).toBe('連続する5枚');
    expect(describeBlock({ kind: 'fixed', ranks: ['10', 'J'] })).toBe('10 J の2枚');
    expect(describeBlock({ kind: 'oneOf', ranks: ['2', '3'], count: 5 })).toBe('2・3 から5枚');
    expect(describeBlock({ kind: 'any', count: 1 })).toBe('任意の1枚');
  });

  it('並べると役の説明と一致する', () => {
    // 順位表に出る文と、編集画面に並ぶ文が食い違うと混乱する。
    for (const hand of STANDARD_VARIANT.ranking.hands) {
      const blocks = toBlocks(hand.pattern)!;
      const fromParts = blocks.map(describeBlock).join('、');
      expect(describePattern(hand.pattern).startsWith(fromParts), hand.name).toBe(true);
    }
  });

  it('枚数を数える', () => {
    expect(blockSize({ kind: 'sameRank', count: 3 })).toBe(3);
    expect(blockSize({ kind: 'fixed', ranks: ['10', 'J', 'Q', 'K', 'A'] })).toBe(5);
  });
});
