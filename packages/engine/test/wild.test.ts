import { describe, expect, it } from 'vitest';
import { buildDeck, cardKey, shuffle } from '../src/deck.js';
import { compareHands, evaluateBest, evaluateExact } from '../src/rules/evaluate.js';
import { allSubstitutions, hasWilds, isWild } from '../src/rules/wild.js';
import { wildResolutions } from '../src/rules/example.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { DEUCES_WILD, JOKER_WILD, ONE_EYED_JACKS } from '../src/rules/variants.js';
import { createGame, reduce } from '../src/game/reduce.js';
import type { Card, GameState, Variant } from '../src/types.js';
import { cards } from './helpers.js';

/** ジョーカーを1枚作る。 */
const joker = (id = 0): Card => ({ rank: 'A', suit: 'spades', joker: id });

function hand(notation: string, variant: Variant, extra: readonly Card[] = []) {
  const result = evaluateBest([...cards(notation), ...extra], variant);
  if (!result) throw new Error(`役が成立しなかった: ${notation}`);
  return result;
}

function tableOf(count: number, variant: Variant): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
  for (let i = 0; i < count; i++) {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips: 1000 });
  }
  return state;
}

// ============================================================
// デッキとジョーカー
// ============================================================

describe('ジョーカー入りのデッキ', () => {
  it('枚数を指定できる', () => {
    expect(buildDeck({ suits: STANDARD_VARIANT.deck.suits, ranks: STANDARD_VARIANT.deck.ranks })).toHaveLength(52);
    expect(buildDeck(JOKER_WILD.deck)).toHaveLength(53);
    expect(buildDeck({ ...JOKER_WILD.deck, jokers: 2 })).toHaveLength(54);
  });

  it('ジョーカーは実在のカードと区別される', () => {
    // rank と suit には意味がないので、それで比べると実在の札と衝突する。
    const realAceOfSpades: Card = { rank: 'A', suit: 'spades' };
    expect(cardKey(joker(0))).not.toBe(cardKey(realAceOfSpades));
    expect(cardKey(joker(0))).not.toBe(cardKey(joker(1)));
  });

  it('デッキの中でジョーカーどうしも区別される', () => {
    const deck = buildDeck({ ...JOKER_WILD.deck, jokers: 3 });
    const keys = deck.map(cardKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ============================================================
// どのカードがワイルドか
// ============================================================

describe('ワイルドの指定', () => {
  it('ワイルドを使わないバリアントでは何もワイルドにならない', () => {
    expect(hasWilds(STANDARD_VARIANT)).toBe(false);
    expect(isWild(joker(), STANDARD_VARIANT)).toBe(false);
    expect(isWild({ rank: '2', suit: 'spades' }, STANDARD_VARIANT)).toBe(false);
  });

  it('ジョーカー指定ならジョーカーだけ', () => {
    expect(isWild(joker(), JOKER_WILD)).toBe(true);
    expect(isWild({ rank: '2', suit: 'spades' }, JOKER_WILD)).toBe(false);
    expect(isWild({ rank: 'A', suit: 'spades' }, JOKER_WILD)).toBe(false);
  });

  it('ランク指定ならそのランク全部', () => {
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'] as const) {
      expect(isWild({ rank: '2', suit }, DEUCES_WILD), suit).toBe(true);
    }
    expect(isWild({ rank: '3', suit: 'spades' }, DEUCES_WILD)).toBe(false);
    expect(isWild(joker(), DEUCES_WILD)).toBe(false);
  });

  it('カード指定ならそのカードだけ', () => {
    expect(isWild({ rank: 'J', suit: 'spades' }, ONE_EYED_JACKS)).toBe(true);
    expect(isWild({ rank: 'J', suit: 'hearts' }, ONE_EYED_JACKS)).toBe(true);
    expect(isWild({ rank: 'J', suit: 'diamonds' }, ONE_EYED_JACKS)).toBe(false);
    expect(isWild({ rank: 'J', suit: 'clubs' }, ONE_EYED_JACKS)).toBe(false);
  });
});

describe('置き換えの列挙', () => {
  it('ワイルドが無ければ元の並びを1つだけ返す', () => {
    const five = cards('As Ks Qs Js Ts');
    expect(allSubstitutions(five, STANDARD_VARIANT)).toEqual([five]);
    expect(allSubstitutions(five, JOKER_WILD)).toEqual([five]);
  });

  it('ジョーカー1枚ならデッキの種類数ぶん', () => {
    const withJoker = [...cards('As Ks Qs Js'), joker()];
    expect(allSubstitutions(withJoker, JOKER_WILD)).toHaveLength(52);
  });

  it('化ける先を絞れる', () => {
    const limited: Variant = {
      ...JOKER_WILD,
      ranking: {
        ...JOKER_WILD.ranking,
        wilds: [{ cards: { kind: 'joker' }, becomes: { ranks: ['A'], suits: ['spades', 'hearts'] } }],
      },
    };
    const withJoker = [...cards('Ks Qs Js Ts'), joker()];
    const subs = allSubstitutions(withJoker, limited);
    expect(subs).toHaveLength(2);
    for (const sub of subs) {
      expect(sub[4]!.rank).toBe('A');
      expect(['spades', 'hearts']).toContain(sub[4]!.suit);
    }
  });

  it('元の並びは壊さない', () => {
    const withJoker = [...cards('As Ks Qs Js'), joker()];
    const copy = [...withJoker];
    allSubstitutions(withJoker, JOKER_WILD);
    expect(withJoker).toEqual(copy);
  });
});

// ============================================================
// 役の判定
// ============================================================

describe('ワイルドが混ざった役', () => {
  it('ジョーカーがストレートフラッシュを完成させる', () => {
    // 9s 8s 7s 6s + ジョーカー → 5s か 10s になって成立
    const result = hand('9s 8s 7s 6s', JOKER_WILD, [joker()]);
    expect(result.rankingId).toBe('straight_flush');
  });

  it('ジョーカーは一番強くなる札を選ぶ', () => {
    // 9s 8s 7s 6s なら 10s にすれば 10-high、5s なら 9-high。強いほうを採る。
    const high = hand('9s 8s 7s 6s', JOKER_WILD, [joker()]);
    const tenHigh = hand('Ts 9s 8s 7s 6s', JOKER_WILD);
    expect(compareHands(high, tenHigh)).toBe(0);
  });

  it('ファイブカードが成立する', () => {
    const result = hand('As Ah Ad Ac', JOKER_WILD, [joker()]);
    expect(result.rankingId).toBe('five_of_a_kind');
  });

  it('ファイブカードはストレートフラッシュより強い', () => {
    const five = hand('As Ah Ad Ac', JOKER_WILD, [joker()]);
    const straightFlush = hand('9s 8s 7s 6s 5s', JOKER_WILD);
    expect(compareHands(five, straightFlush)).toBeGreaterThan(0);
  });

  it('ロイヤルフラッシュも作れる', () => {
    expect(hand('As Ks Qs Js', JOKER_WILD, [joker()]).rankingId).toBe('royal_flush');
  });

  it('ジョーカーが2枚でも動く', () => {
    const result = hand('As Ah Ad', JOKER_WILD, [joker(0), joker(1)]);
    expect(result.rankingId).toBe('five_of_a_kind');
  });

  it('引いた札はジョーカーのまま残る（画面に出すため）', () => {
    const result = hand('As Ah Ad Ac', JOKER_WILD, [joker()]);
    expect(result.cards.some((c) => c.joker !== undefined)).toBe(true);
  });

  it('2がワイルドでは2がどの札にもなる', () => {
    // 2 を A にしてフォーカード
    expect(hand('As Ah Ad 2c Kh', DEUCES_WILD).rankingId).toBe('four_of_a_kind');
    // 標準なら A のスリーカード止まり
    expect(hand('As Ah Ad 2c Kh', STANDARD_VARIANT).rankingId).toBe('three_of_a_kind');
  });

  it('2がワイルドでは2が4枚あるのでファイブカードも出やすい', () => {
    expect(hand('As Ah 2d 2c 2s', DEUCES_WILD).rankingId).toBe('five_of_a_kind');
  });

  it('片目のジャックだけがワイルド', () => {
    // J♠ はワイルドなので A のフォーカードになる
    expect(hand('As Ah Ad Js Kh', ONE_EYED_JACKS).rankingId).toBe('four_of_a_kind');
    // J♦ はワイルドではないのでスリーカード止まり
    expect(hand('As Ah Ad Jd Kh', ONE_EYED_JACKS).rankingId).toBe('three_of_a_kind');
  });

  it('ワイルドを使わないバリアントでは2はただの2', () => {
    expect(hand('As Ah Ad 2c Kh', STANDARD_VARIANT).rankingId).toBe('three_of_a_kind');
  });

  it('ワイルドがあっても通常の手は通常どおり', () => {
    expect(hand('As Ks Qs Js Ts', JOKER_WILD).rankingId).toBe('royal_flush');
    expect(hand('As Ah Kc 3h 2s', JOKER_WILD).rankingId).toBe('one_pair');
  });
});

// ============================================================
// 対局
// ============================================================

describe('ワイルド入りで対局できる', () => {
  /** 全員がチェック/コールで1ラウンド進める。 */
  function callAround(state: GameState): GameState {
    let current = state;
    const street = current.streetIndex;
    let guard = 0;
    while (current.phase === 'betting' && current.streetIndex === street && guard++ < 30) {
      const id = current.turnPlayerId!;
      const needs = current.currentBet > current.players.find((p) => p.id === id)!.bet;
      current = reduce(
        current,
        needs ? { type: 'call', playerId: id } : { type: 'check', playerId: id },
      );
    }
    return current;
  }

  for (const variant of [JOKER_WILD, DEUCES_WILD, ONE_EYED_JACKS]) {
    it(`${variant.name} で決着まで進む`, () => {
      let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 5 });
      for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
      expect(state.phase).toBe('showdown');
      expect(state.summary!.revealed).toHaveLength(3);
    });
  }

  it('ジョーカーを配ってもカードが重複しない', () => {
    const state = reduce(tableOf(6, JOKER_WILD), { type: 'startHand', seed: 3 });
    const all = [...state.players.flatMap((p) => p.holeCards), ...state.deck].map(cardKey);
    expect(new Set(all).size).toBe(all.length);
  });

  it('チップの総量が変わらない', () => {
    const start = tableOf(4, JOKER_WILD);
    const before = start.players.reduce((s, p) => s + p.chips, 0);
    let state = reduce(start, { type: 'startHand', seed: 8 });
    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.players.reduce((s, p) => s + p.chips, 0) + state.pot).toBe(before);
  });
});

// ============================================================
// 絞り込みが正しいことの確認
// ============================================================

describe('役ごとの絞り込みは素朴な総当たりと一致する', () => {
  /**
   * 基準となる素朴な実装。デッキの全種類で置き換えて最強を採る。
   * 遅いので対局には使えないが、正しさの基準にはなる。
   */
  function reference(hand: readonly Card[], variant: Variant) {
    const noWilds: Variant = {
      ...variant,
      ranking: { ...variant.ranking, wilds: [] },
    };
    let best = null;
    for (const sub of allSubstitutions(hand, variant)) {
      const result = evaluateBest(sub, noWilds);
      if (result && (best === null || compareHands(result, best) > 0)) best = result;
    }
    return best;
  }

  /** ワイルドがちょうどn枚入った5枚を集める。 */
  function handsWithWilds(variant: Variant, count: number, want: number): Card[][] {
    const deck = buildDeck(variant.deck);
    const out: Card[][] = [];
    for (let seed = 0; out.length < want && seed < 40000; seed++) {
      const five = shuffle(deck, seed).slice(0, 5);
      if (five.filter((c) => isWild(c, variant)).length === count) out.push(five);
    }
    return out;
  }

  /** ジョーカー2枚入り。1枚のプリセットでは「2枚入った手」が作れない。 */
  const TWO_JOKERS: Variant = {
    ...JOKER_WILD,
    id: 'two-jokers',
    deck: { ...JOKER_WILD.deck, jokers: 2 },
  };

  for (const [variant, count, samples] of [
    [JOKER_WILD, 1, 40],
    [DEUCES_WILD, 1, 40],
    [ONE_EYED_JACKS, 1, 40],
    [DEUCES_WILD, 2, 12],
    [TWO_JOKERS, 2, 6],
  ] as const) {
    it(`${variant.name} / ワイルド${count}枚`, () => {
      const hands = handsWithWilds(variant, count, samples);
      expect(hands.length, '対象の手が集まらなかった').toBeGreaterThan(0);

      for (const hand of hands) {
        const fast = evaluateBest(hand, variant);
        const slow = reference(hand, variant);
        const label = hand.map((c) => (c.joker !== undefined ? 'JOKER' : `${c.rank}${c.suit[0]}`)).join(' ');

        expect(fast?.rankingId, label).toBe(slow?.rankingId);
        expect(fast?.tiebreak, label).toEqual(slow?.tiebreak);
      }
    }, 300000);
  }

  it('ワイルドが無い手でも一致する', () => {
    const deck = buildDeck(JOKER_WILD.deck);
    for (let seed = 0; seed < 40; seed++) {
      const five = shuffle(deck, seed).slice(0, 5);
      if (five.some((c) => isWild(c, JOKER_WILD))) continue;
      expect(evaluateBest(five, JOKER_WILD)?.rankingId).toBe(reference(five, JOKER_WILD)?.rankingId);
    }
  });
});

describe('ワイルドが何に化けたかを返す', () => {
  it('置き換え後の手を resolved で返す', () => {
    const result = evaluateExact(
      [joker(), { rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }, { rank: '3', suit: 'diamonds' }],
      JOKER_WILD,
    )!;
    expect(result.rankingId).toBe('four_of_a_kind');
    // 引いた札はそのまま。画面にジョーカーとして出すため。
    expect(result.cards[0]!.joker).toBe(0);
    // 化けた先は K。スートは役に影響しないのでどれでもよい。
    expect(result.resolved[0]!.rank).toBe('K');
    expect(result.resolved[0]!.joker).toBeUndefined();
    expect(result.resolved).toHaveLength(result.cards.length);
  });

  it('ワイルドを使わない役では置き換えが出ない', () => {
    const result = evaluateExact(
      [
        { rank: 'K', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'clubs' },
        { rank: '3', suit: 'diamonds' },
        { rank: '9', suit: 'spades' },
      ],
      JOKER_WILD,
    )!;
    expect(wildResolutions(result, JOKER_WILD)).toEqual([]);
  });

  it('どの札がどれになったかを位置つきで返す', () => {
    const result = evaluateExact(
      [{ rank: 'J', suit: 'spades' }, { rank: 'J', suit: 'hearts' }, { rank: 'J', suit: 'clubs' }, { rank: '2', suit: 'spades' }, { rank: '2', suit: 'hearts' }],
      DEUCES_WILD,
    )!;
    expect(result.rankingId).toBe('five_of_a_kind');

    const resolutions = wildResolutions(result, DEUCES_WILD);
    expect(resolutions).toHaveLength(2);
    expect(resolutions.map((r) => r.index)).toEqual([3, 4]);
    for (const r of resolutions) {
      expect(r.card.rank).toBe('2');
      expect(r.becomes.rank).toBe('J');
    }
  });

  it('ワイルドの無いルールでは常に空', () => {
    const result = evaluateExact(
      [
        { rank: 'K', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'clubs' },
        { rank: '3', suit: 'diamonds' },
        { rank: '9', suit: 'spades' },
      ],
      STANDARD_VARIANT,
    )!;
    expect(wildResolutions(result, STANDARD_VARIANT)).toEqual([]);
    expect(result.resolved).toBe(result.cards);
  });
});
