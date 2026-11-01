import { describe, expect, it } from 'vitest';
import { fromBlocks, toBlocks, type PatternBlock } from '../src/rules/blocks.js';
import { evaluateExact } from '../src/rules/evaluate.js';
import { exampleHand } from '../src/rules/example.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import type { Card, DeckRules, GlobalCondition, Variant } from '../src/types.js';
import { cards } from './helpers.js';

/**
 * 調べて出てきたローカル役（非標準の役）が、まとまりと全体の条件で表せること。
 * 出典は Wikipedia「Non-standard poker hand」ほか。
 *
 * それぞれ「役として定義できる」「当たるべき手に当たる」「当たってはいけない手に当たらない」
 * 「例が作れる」の4つを見る。
 */

const JOKER: Card = { rank: 'A', suit: 'spades', joker: 0 };

function localVariant(blocks: PatternBlock[], global: GlobalCondition[] = [], deck: Partial<DeckRules> = {}): Variant {
  return {
    ...STANDARD_VARIANT,
    id: 'local',
    name: 'ローカル役',
    deck: { ...STANDARD_VARIANT.deck, ...deck },
    // ローカル役を最上位に、その下に何でも当たる「その他」を置く。
    ranking: {
      hands: [
        { id: 'local', name: 'ローカル役', enabled: true, pattern: fromBlocks(blocks, global) },
        { id: 'other', name: 'その他', enabled: true, pattern: fromBlocks([{ kind: 'any', count: 1 }]) },
      ],
    },
  };
}

const hits = (variant: Variant, hand: Card[] | string) =>
  evaluateExact(typeof hand === 'string' ? cards(hand) : hand, variant)?.rankingId === 'local';

function expectHand(name: string, variant: Variant, yes: (Card[] | string)[], no: (Card[] | string)[]) {
  it(name, () => {
    // まとまりへ戻せる（＝編集画面で開ける）
    expect(toBlocks(variant.ranking.hands[0]!.pattern), `${name}: まとまりに戻せない`).not.toBeNull();
    for (const hand of yes) expect(hits(variant, hand), `${name}: ${String(hand)} に当たるはず`).toBe(true);
    for (const hand of no) expect(hits(variant, hand), `${name}: ${String(hand)} には当たらないはず`).toBe(false);
    const example = exampleHand(variant, 'local', { seed: 5 });
    expect(example, `${name}: 例が作れない`).not.toBeNull();
    expect(hits(variant, example!)).toBe(true);
  });
}

describe('ローカル役を表せる', () => {
  expectHand('フラッシュファイブ（同じランク・同じスートの5枚）',
    localVariant([{ kind: 'sameRank', count: 5 }], [{ type: 'allSameSuit' }], { copies: 2, overrides: [{ rank: 'A', suit: 'spades', count: 5 }] }),
    ['As As As As As'], ['As As As As Ah']);

  expectHand('フラッシュハウス（全部同じスートのフルハウス）',
    localVariant([{ kind: 'sameRank', count: 3 }, { kind: 'sameRank', count: 2 }], [{ type: 'allSameSuit' }], { copies: 3 }),
    ['Ks Ks Ks 2s 2s'], ['Ks Ks Kh 2s 2s']);

  expectHand('ストレートフラッシュハウス（連続5枚、3枚と2枚で別のスート）',
    localVariant([
      { kind: 'run', count: 3, suit: { kind: 'same' } },
      { kind: 'run', count: 2, continues: true, suit: { kind: 'same' } },
    ]),
    ['5s 6s 7s 8h 9h'], ['5s 6s 7s 8s 9s', '5s 6h 7s 8h 9h', '5s 6s 7s 8h Th']);

  expectHand('スキート（2・5・9 と、9 より下の2枚）',
    localVariant([{ kind: 'fixed', ranks: ['2', '5', '9'] }, { kind: 'oneOf', ranks: ['3', '4', '6', '7', '8'], count: 2 }], [{ type: 'allDifferentRank' }]),
    ['2s 4h 5d 6c 9s'], ['2s 5h 9d Tc 3s', '2s 5h 9d 4c 4s']);

  expectHand('ブレイズ（J・Q・K だけの5枚）',
    localVariant([{ kind: 'oneOf', ranks: ['J', 'Q', 'K'], count: 5 }]),
    ['Js Jh Qd Kc Ks'], ['Js Jh Qd Kc As']);

  expectHand('ビッグドッグ（A が上、9 が下、ペアなし）',
    localVariant([{ kind: 'fixed', ranks: ['A', '9'] }, { kind: 'oneOf', ranks: ['10', 'J', 'Q', 'K'], count: 3 }], [{ type: 'allDifferentRank' }]),
    ['As Kh Jd Tc 9s'], ['As Kh Kd Tc 9s', 'As Kh Jd 8c 9s']);

  expectHand('ファイブアンドダイム（5 が下、10 が上、ペアなし）',
    localVariant([{ kind: 'fixed', ranks: ['10', '5'] }, { kind: 'oneOf', ranks: ['6', '7', '8', '9'], count: 3 }], [{ type: 'allDifferentRank' }]),
    ['5s 6h 7d 8c Ts'], ['5s 6h 6d 8c Ts']);

  expectHand('スキップストレート（1つ飛ばしの連続）',
    localVariant([{ kind: 'run', count: 5, step: 2 }]),
    ['3s 5h 7d 9c Js'], ['3s 4h 5d 6c 7s', '3s 5h 7d 9c Qs']);

  expectHand('回り込みストレート（Q K A 2 3）',
    localVariant([{ kind: 'run', count: 5, wrap: true }]),
    ['Qs Kh Ad 2c 3s', 'Js Qh Kd Ac 2s', '4s 5h 6d 7c 8s'], ['Qs Kh Ad 2c 4s']);

  expectHand('フラッシュ（4つのスートが1枚ずつ＋ジョーカー）',
    localVariant([{ kind: 'any', count: 5 }], [{ type: 'suitKinds', count: 4 }], { jokers: 1 }),
    [[...cards('As Kh 5d 7c'), JOKER], 'As Kh 5d 7c 9s'], ['As Kh 5d 7h 9s']);

  expectHand('ビッグボブテイル（4枚のストレートフラッシュ）',
    localVariant([{ kind: 'run', count: 4, suit: { kind: 'same' } }]),
    ['5s 6s 7s 8s Kh'], ['5s 6s 7s 8h Kh']);

  expectHand('カラーフラッシュ（5枚すべて同じ色）',
    localVariant([{ kind: 'any', count: 5 }], [{ type: 'allSameColor' }]),
    ['As Kc 5s 7c 9s', 'Ah Kd 5h 7d 9h'], ['As Kc 5s 7c 9h']);

  expectHand('赤だけのストレート',
    localVariant([{ kind: 'run', count: 5 }], [{ type: 'color', color: 'red' }]),
    ['5h 6d 7h 8d 9h'], ['5h 6d 7h 8d 9s', '5s 6c 7s 8c 9s']);

  expectHand('赤が4枚以上',
    localVariant([{ kind: 'any', count: 5 }], [{ type: 'colorCount', color: 'red', count: 4 }]),
    ['5h 6d 7h 8d 9s'], ['5h 6d 7h 8s 9s']);

  expectHand('スペードの A を含む',
    localVariant([{ kind: 'fixed', ranks: ['A'], suit: { kind: 'in', suits: ['spades'] } }]),
    ['As 6d 7h 8d 9s'], ['Ah 6d 7h 8d 9s']);
});
