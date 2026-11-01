import { describe, expect, it } from 'vitest';
import {
  describePattern,
  describeWilds,
  exampleHand,
  exampleHands,
} from '../src/rules/example.js';
import { evaluateExact } from '../src/rules/evaluate.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { VARIANT_PRESETS, activeRankings } from '../src/rules/variants.js';
import { buildDeck, cardKey } from '../src/deck.js';
import { isWild } from '../src/rules/wild.js';
import type { Variant } from '../src/types.js';

/** その例が、本当にその役ちょうどで成立しているか。 */
function assertExactly(variant: Variant, rankingId: string, seed = 1) {
  const hand = exampleHand(variant, rankingId, { seed });
  expect(hand, `${variant.name} / ${rankingId} の例が作れなかった`).not.toBeNull();
  expect(hand).toHaveLength(variant.structure.handSize);

  const result = evaluateExact(hand!, variant);
  expect(result?.rankingId, `${variant.name} / ${rankingId}: 別の役になっている`).toBe(rankingId);
  return hand!;
}

describe('どの役でも例が作れる', () => {
  for (const variant of VARIANT_PRESETS) {
    it(`${variant.name}`, () => {
      for (const ranking of activeRankings(variant)) {
        assertExactly(variant, ranking.id);
      }
    }, 60000);
  }
});

describe('例は「その役ちょうど」である', () => {
  it('より強い役には当てはまらない', () => {
    // これが無いと「ミニストレートの例」としてロイヤルフラッシュを出してしまう。
    for (const ranking of activeRankings(STANDARD_VARIANT)) {
      const hand = assertExactly(STANDARD_VARIANT, ranking.id);
      const result = evaluateExact(hand, STANDARD_VARIANT)!;
      const index = STANDARD_VARIANT.ranking.hands.findIndex((h) => h.id === ranking.id);
      expect(result.rankingIndex, ranking.name).toBe(index);
    }
  });

  it('ハイカードの例がペアになっていない', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'high_card');
    expect(new Set(hand.map((c) => c.rank)).size).toBe(hand.length);
  });

  it('ワンペアの例がツーペアになっていない', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'one_pair');
    const counts = new Map<string, number>();
    for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    expect([...counts.values()].filter((n) => n >= 2)).toHaveLength(1);
  });

  it('フラッシュの例がストレートフラッシュになっていない', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'flush');
    expect(new Set(hand.map((c) => c.suit)).size).toBe(1);
    expect(evaluateExact(hand, STANDARD_VARIANT)!.rankingId).toBe('flush');
  });
});

describe('例はデッキに実在する札で作られる', () => {
  it('デッキに無い札を使わない', () => {
    for (const variant of VARIANT_PRESETS) {
      const deck = new Set(buildDeck(variant.deck).map(cardKey));
      for (const ranking of activeRankings(variant)) {
        const hand = exampleHand(variant, ranking.id, { seed: 3 });
        if (!hand) continue;
        for (const card of hand) {
          expect(deck.has(cardKey(card)), `${variant.name} / ${ranking.id}: ${cardKey(card)}`).toBe(
            true,
          );
        }
      }
    }
  }, 60000);

  it('同じ札を枚数以上に使わない', () => {
    const counts = new Map<string, number>();
    for (const card of buildDeck(STANDARD_VARIANT.deck)) {
      counts.set(cardKey(card), (counts.get(cardKey(card)) ?? 0) + 1);
    }
    for (const ranking of activeRankings(STANDARD_VARIANT)) {
      const hand = exampleHand(STANDARD_VARIANT, ranking.id, { seed: 5 });
      if (!hand) continue;
      const used = new Map<string, number>();
      for (const card of hand) used.set(cardKey(card), (used.get(cardKey(card)) ?? 0) + 1);
      for (const [key, n] of used) {
        expect(n, `${ranking.id}: ${key}`).toBeLessThanOrEqual(counts.get(key) ?? 0);
      }
    }
  });

  it('ショートデッキの例に2〜5が出ない', () => {
    const shortDeck = VARIANT_PRESETS.find((v) => v.id === 'short-deck')!;
    for (const ranking of activeRankings(shortDeck)) {
      const hand = exampleHand(shortDeck, ranking.id, { seed: 2 });
      if (!hand) continue;
      for (const card of hand) {
        expect(['2', '3', '4', '5']).not.toContain(card.rank);
      }
    }
  });
});

describe('例は読みやすい並びになっている', () => {
  const ranksOf = (variant: Variant, hand: readonly { rank: string }[]) =>
    hand.map((c) => variant.deck.ranks.indexOf(c.rank as never));

  it('同じ条件が続く区間は強い順（左が強い）に並ぶ', () => {
    // 2♥ J♣ K♣ 5♣ 3♥ のように散らばると、何が条件を満たしているのか
    // 目で追えない。素数ストレートは5枚すべて同じ条件なので全体が強い順になる。
    const prime = VARIANT_PRESETS.find((v) => v.id === 'prime')!;
    const hand = assertExactly(prime, 'prime');
    const values = ranksOf(prime, hand);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('フラッシュの例も強い順に並ぶ', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'flush');
    const values = ranksOf(STANDARD_VARIANT, hand);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('フルハウスは3枚組が先（条件の順を崩さない）', () => {
    // この並び自体が役の説明になっているので、ランクで一律に
    // 並べ替えてはいけない。
    const hand = assertExactly(STANDARD_VARIANT, 'full_house');
    expect(hand[0]!.rank).toBe(hand[1]!.rank);
    expect(hand[1]!.rank).toBe(hand[2]!.rank);
    expect(hand[3]!.rank).toBe(hand[4]!.rank);
    expect(hand[0]!.rank).not.toBe(hand[3]!.rank);
  });

  it('条件を満たす札が先、キッカーが後', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'one_pair');
    expect(hand[0]!.rank).toBe(hand[1]!.rank);
    for (const card of hand.slice(2)) expect(card.rank).not.toBe(hand[0]!.rank);
  });

  it('ストレートは上から下へ並ぶ（左が強い）', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'straight');
    const values = ranksOf(STANDARD_VARIANT, hand);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('ハイカードも左が強い（任意の1枚とキッカーをまとめて並べる）', () => {
    const hand = assertExactly(STANDARD_VARIANT, 'high_card');
    const values = ranksOf(STANDARD_VARIANT, hand);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('ロイヤルは A K Q J 10、ホイールは 5 4 3 2 A', () => {
    expect(assertExactly(STANDARD_VARIANT, 'royal_flush').map((c) => c.rank)).toEqual(['A', 'K', 'Q', 'J', '10']);
    expect(assertExactly(STANDARD_VARIANT, 'wheel').map((c) => c.rank)).toEqual(['5', '4', '3', '2', 'A']);
  });

  it('ストレートの例がフラッシュに見えない', () => {
    // 10♣ J♣ Q♥ K♣ A♦ のように同じスートが4枚あると、
    // 何の役の例を見ているのか分からなくなる。
    for (const id of ['straight', 'three_of_a_kind', 'two_pair']) {
      const hand = assertExactly(STANDARD_VARIANT, id);
      const bySuit = new Map<string, number>();
      for (const c of hand) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
      expect(Math.max(...bySuit.values()), id).toBeLessThanOrEqual(2);
    }
  });

  it('同じスートが要る役では散らさない', () => {
    // 散らすのは「スートが結果に関わらない役」だけ。
    const hand = assertExactly(STANDARD_VARIANT, 'flush');
    expect(new Set(hand.map((c) => c.suit)).size).toBe(1);
  });

  it('ワイルドは並びの後ろに回る', () => {
    // ランクが飾りなので、並べる材料にならない。
    const joker = VARIANT_PRESETS.find((v) => v.id === 'joker-wild')!;
    const hand = assertExactly(joker, 'five_of_a_kind');
    expect(isWild(hand[hand.length - 1]!, joker)).toBe(true);
  });
});

describe('ワイルドは必要なときだけ使う', () => {
  const wildVariants = VARIANT_PRESETS.filter((v) => (v.ranking.wilds ?? []).length > 0);

  it('ファイブカードの例にはワイルドが入る', () => {
    // 同じランクは4枚しかないので、ワイルド抜きでは成立しない。
    expect(wildVariants.length).toBeGreaterThan(0);
    for (const variant of wildVariants) {
      const hand = assertExactly(variant, 'five_of_a_kind');
      expect(
        hand.filter((c) => isWild(c, variant)).length,
        `${variant.name}: ワイルドなしでファイブカードになっている`,
      ).toBeGreaterThan(0);
    }
  });

  it('実札で足りる役にはワイルドを使わない', () => {
    // スートの抽選が重なっただけでワイルドに逃げると、
    // 「フォーカードなのに3枚しか見えない」読めない例になる。
    const joker = VARIANT_PRESETS.find((v) => v.id === 'joker-wild')!;
    for (const id of ['one_pair', 'two_pair', 'three_of_a_kind', 'four_of_a_kind', 'flush']) {
      const hand = assertExactly(joker, id);
      expect(hand.filter((c) => isWild(c, joker)), id).toHaveLength(0);
    }
  });

  it('フォーカードの例は同じランクが4枚見える', () => {
    const joker = VARIANT_PRESETS.find((v) => v.id === 'joker-wild')!;
    const hand = assertExactly(joker, 'four_of_a_kind');
    const counts = new Map<string, number>();
    for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(4);
  });
});

describe('種を変えると別の例が出る', () => {
  it('同じ種からは同じ例', () => {
    expect(exampleHand(STANDARD_VARIANT, 'flush', { seed: 7 })).toEqual(
      exampleHand(STANDARD_VARIANT, 'flush', { seed: 7 }),
    );
  });

  it('違う種からは違う例が出ることがある', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const hand = exampleHand(STANDARD_VARIANT, 'one_pair', { seed });
      if (hand) seen.add(hand.map(cardKey).sort().join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('まとめて例を作る', () => {
  it('有効な役の数だけ返す', () => {
    const examples = exampleHands(STANDARD_VARIANT);
    expect(examples.size).toBe(activeRankings(STANDARD_VARIANT).length);
    for (const [id, hand] of examples) {
      expect(hand, `${id} の例が無い`).not.toBeNull();
    }
  });

  it('無効にした役は含まれない', () => {
    const noFlush: Variant = {
      ...STANDARD_VARIANT,
      ranking: {
        ...STANDARD_VARIANT.ranking,
        hands: STANDARD_VARIANT.ranking.hands.map((h) =>
          h.id === 'flush' ? { ...h, enabled: false } : h,
        ),
      },
    };
    expect(exampleHands(noFlush).has('flush')).toBe(false);
    expect(exampleHand(noFlush, 'flush')).toBeNull();
  });

  it('知らない役は null', () => {
    expect(exampleHand(STANDARD_VARIANT, '存在しない役')).toBeNull();
  });
});

describe('条件を日本語にする', () => {
  const describeOf = (variant: Variant, id: string) =>
    describePattern(variant.ranking.hands.find((h) => h.id === id)!.pattern);

  it('同じランクのまとまりを数える', () => {
    expect(describeOf(STANDARD_VARIANT, 'one_pair')).toBe('同じランクが2枚');
    expect(describeOf(STANDARD_VARIANT, 'three_of_a_kind')).toBe('同じランクが3枚');
    expect(describeOf(STANDARD_VARIANT, 'four_of_a_kind')).toBe('同じランクが4枚');
  });

  it('2つのまとまりを両方書く', () => {
    expect(describeOf(STANDARD_VARIANT, 'full_house')).toBe('同じランクが3枚、同じランクが2枚');
    expect(describeOf(STANDARD_VARIANT, 'two_pair')).toBe('同じランクが2枚、同じランクが2枚');
  });

  it('連続を見分ける', () => {
    expect(describeOf(STANDARD_VARIANT, 'straight')).toBe('連続する5枚');
    expect(describeOf(STANDARD_VARIANT, 'straight_flush')).toBe('連続する5枚、すべて同じスート');
  });

  it('固定ランクを並べる', () => {
    expect(describeOf(STANDARD_VARIANT, 'royal_flush')).toBe(
      '10 J Q K A の5枚、すべて同じスート',
    );
  });

  it('いずれかの指定を書く', () => {
    const prime = VARIANT_PRESETS.find((v) => v.id === 'prime')!;
    expect(describeOf(prime, 'prime')).toContain('から5枚');
    expect(describeOf(prime, 'prime')).toContain('すべて違うランク');
  });

  it('任意の枚数を書く', () => {
    expect(describeOf(STANDARD_VARIANT, 'flush')).toBe('任意の5枚、すべて同じスート');
    expect(describeOf(STANDARD_VARIANT, 'high_card')).toBe('任意の1枚');
  });

  it('独自役も説明できる', () => {
    const house = VARIANT_PRESETS.find((v) => v.id === 'house-hands')!;
    expect(describeOf(house, 'pair_plus_run')).toBe('同じランクが2枚、連続する3枚');
    expect(describeOf(house, 'mini_straight')).toBe('連続する3枚');
  });
});

describe('ワイルドの指定を日本語にする', () => {
  const describe_ = (id: string) => describeWilds(VARIANT_PRESETS.find((v) => v.id === id)!);

  it('ワイルドが無ければ null', () => {
    expect(describeWilds(STANDARD_VARIANT)).toBeNull();
  });

  it('ジョーカー', () => {
    expect(describe_('joker-wild')).toBe('ジョーカーがワイルド');
  });

  it('ランク指定', () => {
    expect(describe_('deuces-wild')).toBe('2がワイルド');
  });

  it('カード指定はスート名で書く', () => {
    // ♠ ♥ の記号はエンジンの責任ではない（読み上げにも使う）。
    expect(describe_('one-eyed-jacks')).toBe('スペードのJ・ハートのJがワイルド');
  });

  it('化ける先の制限を書く', () => {
    const limited: Variant = {
      ...STANDARD_VARIANT,
      ranking: {
        ...STANDARD_VARIANT.ranking,
        wilds: [{ cards: { kind: 'joker' }, becomes: { suits: ['spades'] } }],
      },
    };
    expect(describeWilds(limited)).toBe('ジョーカー（スペードにのみ化ける）がワイルド');
  });
});
