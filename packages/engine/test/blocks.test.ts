import { describe, expect, it } from 'vitest';
import { blockSize, describeBlock, fromBlocks, toBlocks, type PatternBlock } from '../src/rules/blocks.js';
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

describe('隣り合う同じ種類のまとまり', () => {
  const cases: PatternBlock[][] = [
    [{ kind: 'fixed', ranks: ['A', '5'] }, { kind: 'fixed', ranks: ['K'] }],
    [{ kind: 'any', count: 2 }, { kind: 'any', count: 1 }],
    [{ kind: 'oneOf', ranks: ['J', 'Q'], count: 1 }, { kind: 'oneOf', ranks: ['J', 'Q'], count: 2 }],
    [{ kind: 'fixed', ranks: ['A'], suit: { kind: 'in', suits: ['spades'] } }, { kind: 'fixed', ranks: ['A'], suit: { kind: 'in', suits: ['spades'] } }],
  ];
  it.each(cases.map((blocks) => [blocks.map((b) => b.kind).join('+'), blocks] as const))('%s は合体しない', (_name, blocks) => {
    expect(toBlocks(fromBlocks(blocks))).toEqual(blocks);
  });

  it('見分けがつくときは区切りを書かない', () => {
    const pattern = fromBlocks([{ kind: 'fixed', ranks: ['A'] }, { kind: 'any', count: 2 }, { kind: 'fixed', ranks: ['K'], suit: { kind: 'in', suits: ['hearts'] } }]);
    expect(pattern.cards.some((card) => card.split)).toBe(false);
  });
});

describe('まとまりで表せない形', () => {
  it('同じまとまりの中で札ごとにスートが違う役', () => {
    // 同じ変数の 2枚が別々のスートを指定している。まとまり単位のスートでは言えない。
    const pattern: HandPattern = {
      cards: [
        { rank: { type: 'variable', name: 'X' }, suits: ['spades'] },
        { rank: { type: 'variable', name: 'X' }, suits: ['hearts'] },
      ],
      global: [],
    };
    expect(toBlocks(pattern)).toBeNull();
  });

  it('等間隔でない相対指定', () => {
    // X, X+1, X+3 は「連続」でも「飛ばし」でもない。
    const pattern: HandPattern = {
      cards: [
        { rank: { type: 'variable', name: 'X' }, suits: [] },
        { rank: { type: 'variable', name: 'X', offset: 1 }, suits: [] },
        { rank: { type: 'variable', name: 'X', offset: 3 }, suits: [] },
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

describe('スート・飛ばし・回り込み・続き', () => {
  const roundTrip = (blocks: PatternBlock[]) => expect(toBlocks(fromBlocks(blocks))).toEqual(blocks);

  it('まとまりごとのスートを行き来できる', () => {
    roundTrip([{ kind: 'sameRank', count: 3, suit: { kind: 'same' } }, { kind: 'sameRank', count: 2, suit: { kind: 'same' } }]);
    roundTrip([{ kind: 'fixed', ranks: ['A'], suit: { kind: 'in', suits: ['spades'] } }, { kind: 'any', count: 4 }]);
    roundTrip([{ kind: 'any', count: 5, suit: { kind: 'in', suits: ['hearts', 'diamonds'] } }]);
  });

  it('1つ飛ばし・回り込み・続きを行き来できる', () => {
    roundTrip([{ kind: 'run', count: 5, step: 2 }]);
    roundTrip([{ kind: 'run', count: 5, wrap: true }]);
    roundTrip([
      { kind: 'run', count: 3, suit: { kind: 'same' } },
      { kind: 'run', count: 2, continues: true, suit: { kind: 'same' } },
    ]);
  });

  it('説明にスートと飛ばしが入る', () => {
    expect(describeBlock({ kind: 'run', count: 5, step: 2 })).toBe('1つ飛ばしで連続する5枚');
    expect(describeBlock({ kind: 'run', count: 5, wrap: true })).toBe('連続する5枚（回り込みあり）');
    expect(describeBlock({ kind: 'any', count: 5, suit: { kind: 'in', suits: ['hearts', 'diamonds'] } })).toBe('任意の5枚、赤');
    expect(describeBlock({ kind: 'sameRank', count: 3, suit: { kind: 'same' } })).toBe('同じランクが3枚、同じスート');
  });
});
