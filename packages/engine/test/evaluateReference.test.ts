import { describe, expect, it } from 'vitest';
import { buildDeck } from '../src/deck.js';
import { createRng } from '../src/rng.js';
import { combinations, compareHands, evaluateExact, evaluateHand } from '../src/rules/evaluate.js';
import {
  ACE_LOW, BASEBALL, BIG_O, BLAZE, BOBTAIL, DEUCES_WILD, DR_PEPPER, FLUSH_OVER_FULL_HOUSE, GREEK, HOUSE_HANDS,
  JOKER_WILD, MANILA, OMAHA, OMAHA_SIX, ONE_EYED_JACKS, PRIME_RULES, RED_AND_BLACK, ROYAL_HOLDEM, SHORT_DECK,
  SIX_CARD_FLOP, SKEETS_AND_DOGS, SUPER_HOLDEM, SUIT_RANKED, TAHOE, TRIPLE_DECK, TWO_JOKERS, VARIANT_PRESETS, WRAPAROUND,
} from '../src/rules/variants.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { boardSize, boardUsageOf, holeUsageOf } from '../src/variant.js';
import { RANKS, type Card, type Rank, type Suit, type Variant } from '../src/types.js';
import { OrderCheck, STANDARD_REF, cardText, draw, refKey, refWildKey, subsets, type RefRules } from './reference.js';

/**
 * 役判定を、独立に書いた素朴な答え（test/reference.ts）と突き合わせる。
 *
 * 「この手はフルハウス」と1つずつ書くテストでは、思いついた手しか確かめられない。
 * ここではランダムな手（小さいデッキは全通り）を大量に作り、
 * - 役の名前（段階）が答えと同じか
 * - 強さの並べ方が答えとまったく同じか（引き分けになる組も含めて）
 * を見る。答えの側はパターンや変数を使わず、枚数を数えるだけで書いてある。
 *
 * 全通りを試すと52枚で約1分かかるので、普段はランダムに選んだ手で確かめ、
 * `npm run test:deep` で全通りと10倍の件数を回す（数分かかる）。
 */

// npm run test:deep か EXHAUSTIVE=1 で深く回す。
const EXHAUSTIVE = process.env.npm_lifecycle_event === 'test:deep' || process.env.EXHAUSTIVE === '1';
/** 深く回すときの倍率。 */
const SCALE = EXHAUSTIVE ? 10 : 1;
/** 普段のテストで1つのルールあたりに試す5枚の手の数。 */
const SAMPLES = 3000 * SCALE;
/** 手札と場を配って最強の5枚を選ばせる回数。 */
const DEALS = 200 * SCALE;
/** ワイルド入りは答えの計算が重い（置き換えを全部試す）ので回数を絞る。 */
const WILD_SAMPLES = 500 * SCALE;
const WILD_DEALS = 50 * SCALE;
const hasWildCards = (variant: Variant) => (variant.ranking.wilds ?? []).length > 0 || (variant.deck.jokers ?? 0) > 0;

const ACE_LOW_RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** 答えを持っている（ワイルドなし）ルール。 */
const PLAIN: readonly { readonly variant: Variant; readonly rules: RefRules }[] = [
  { variant: STANDARD_VARIANT, rules: STANDARD_REF },
  { variant: FLUSH_OVER_FULL_HOUSE, rules: { ...STANDARD_REF, flushOverBoat: true } },
  { variant: ACE_LOW, rules: { strength: ACE_LOW_RANKS, sequence: ACE_LOW_RANKS } },
  { variant: SHORT_DECK, rules: { strength: SHORT_DECK.deck.ranks, lowStraight: ['A', '6', '7', '8', '9'], flushOverBoat: true } },
  { variant: MANILA, rules: { strength: MANILA.deck.ranks, lowStraight: ['A', '7', '8', '9', '10'], flushOverBoat: true } },
  { variant: ROYAL_HOLDEM, rules: { strength: ROYAL_HOLDEM.deck.ranks } },
  { variant: TRIPLE_DECK, rules: { ...STANDARD_REF, fiveOfAKind: true, flushHouse: true } },
];

const WITH_FIVE: RefRules = { ...STANDARD_REF, fiveOfAKind: true };
const rankWild = (...ranks: Rank[]) => (card: Card) => card.joker === undefined && ranks.includes(card.rank);

/** 答えを持っているワイルド入りのルール。ワイルドの判定もエンジンを使わずに書く。 */
const WILD: readonly { readonly variant: Variant; readonly isWild: (card: Card) => boolean }[] = [
  { variant: JOKER_WILD, isWild: (card) => card.joker !== undefined },
  { variant: TWO_JOKERS, isWild: (card) => card.joker !== undefined },
  { variant: DEUCES_WILD, isWild: rankWild('2') },
  { variant: BASEBALL, isWild: rankWild('3', '9') },
  { variant: DR_PEPPER, isWild: rankWild('2', '4', '10') },
  {
    variant: ONE_EYED_JACKS,
    isWild: (card) => card.joker === undefined && card.rank === 'J' && (card.suit === 'spades' || card.suit === 'hearts'),
  },
];

const combinationCount = (n: number, k: number) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/** 5枚の手を、全通り（小さいとき・EXHAUSTIVE のとき）かランダムに作る。 */
function* fiveCardHands(variant: Variant, seed: number, samples = SAMPLES): Generator<readonly Card[]> {
  const deck = buildDeck(variant.deck);
  const distinct = (variant.deck.copies ?? 1) === 1;
  if (distinct && (EXHAUSTIVE || combinationCount(deck.length, 5) <= 20_000)) {
    yield* combinations(deck, 5);
    return;
  }
  const rng = createRng(seed);
  for (let i = 0; i < samples; i++) yield draw(deck, 5, rng);
}

describe('5枚の役は、素朴な答えと同じ段階・同じ並びになる', () => {
  for (const { variant, rules } of PLAIN) {
    it(variant.name, () => {
      const order = new OrderCheck();
      for (const hand of fiveCardHands(variant, 11)) {
        const engine = evaluateExact(hand, variant);
        expect(engine, `どの役にもならない: ${cardText(hand)}`).not.toBeNull();
        order.add(refKey(hand, rules), engine!, cardText(hand));
      }
      order.verify();
    }, EXHAUSTIVE ? 600_000 : 30_000);
  }

  it('52枚の全通りでは、教科書どおりの段階数（7462）になる', () => {
    if (!EXHAUSTIVE) return;
    const order = new OrderCheck();
    const counts = new Map<string, number>();
    for (const hand of combinations(buildDeck(STANDARD_VARIANT.deck), 5)) {
      const engine = evaluateExact(hand, STANDARD_VARIANT)!;
      counts.set(engine.rankingId, (counts.get(engine.rankingId) ?? 0) + 1);
      order.add(refKey(hand, STANDARD_REF), engine, cardText(hand));
    }
    order.verify();
    expect(order.size).toBe(7462);
    // よく知られた出現数。ストレートとストレートフラッシュはホイールとロイヤルを別の役に分けている。
    expect(Object.fromEntries(counts)).toEqual({
      royal_flush: 4, straight_flush: 32, steel_wheel: 4, four_of_a_kind: 624, full_house: 3744, flush: 5108,
      straight: 9180, wheel: 1020, three_of_a_kind: 54912, two_pair: 123552, one_pair: 1098240, high_card: 1302540,
    });
  }, 600_000);
});

/** ワイルドが多めに入るよう、ワイルドを先に何枚か混ぜてから残りを引く。 */
function wildHeavyHand(deck: readonly Card[], isWild: (card: Card) => boolean, rng: () => number): Card[] {
  const wilds = deck.filter(isWild);
  const want = Math.min(wilds.length, Math.floor(rng() * 5));
  const picked = draw(wilds, want, rng);
  const rest = deck.filter((c) => !picked.includes(c));
  return [...picked, ...draw(rest, 5 - want, rng)];
}

describe('ワイルド入りの5枚は、すべての置き換えを試した答えと同じになる', () => {
  for (const { variant, isWild } of WILD) {
    it(variant.name, () => {
      const deck = buildDeck(variant.deck);
      const rng = createRng(23);
      const order = new OrderCheck();
      for (let i = 0; i < WILD_SAMPLES; i++) {
        // 半分は普通に引き、半分はワイルドを多めに混ぜる（4〜5枚ワイルドの端も踏む）。
        const hand = i % 2 === 0 ? draw(deck, 5, rng) : wildHeavyHand(deck, isWild, rng);
        const engine = evaluateExact(hand, variant);
        expect(engine, `どの役にもならない: ${cardText(hand)}`).not.toBeNull();
        order.add(refWildKey(hand, isWild, WITH_FIVE), engine!, cardText(hand));
      }
      order.verify();
    }, 60_000);
  }
});

/** 使う枚数の制約を守った5枚の選び方をすべて挙げる（エンジンとは別に書く）。 */
function legalFives(hole: readonly Card[], board: readonly Card[], variant: Variant): Card[][] {
  const hu = holeUsageOf(variant.structure), bu = boardUsageOf(variant.structure);
  const out: Card[][] = [];
  for (let h = 0; h <= variant.structure.handSize; h++) {
    const b = variant.structure.handSize - h;
    if (h < hu.min || h > hu.max || b < bu.min || b > bu.max) continue;
    for (const fromHole of subsets(hole, h)) for (const fromBoard of subsets(board, b)) out.push([...fromHole, ...fromBoard]);
  }
  return out;
}

const STRUCTURED: readonly { readonly variant: Variant; readonly key: (five: readonly Card[]) => number[] }[] = [
  ...[STANDARD_VARIANT, OMAHA, BIG_O, OMAHA_SIX, GREEK, SUPER_HOLDEM, TAHOE, SIX_CARD_FLOP].map((variant) => ({
    variant,
    key: (five: readonly Card[]) => refKey(five, STANDARD_REF),
  })),
  ...PLAIN.filter(({ variant }) => variant !== STANDARD_VARIANT).map(({ variant, rules }) => ({
    variant,
    key: (five: readonly Card[]) => refKey(five, rules),
  })),
  ...WILD.map(({ variant, isWild }) => ({ variant, key: (five: readonly Card[]) => refWildKey(five, isWild, WITH_FIVE) })),
];

describe('手札と場から、使う枚数を守って最強の5枚を選ぶ', () => {
  for (const { variant, key } of STRUCTURED) {
    it(variant.name, () => {
      const deck = buildDeck(variant.deck);
      const holeCards = variant.structure.holeCards;
      const boardCards = boardSize(variant.structure);
      const hu = holeUsageOf(variant.structure), bu = boardUsageOf(variant.structure);
      const rng = createRng(37);
      const order = new OrderCheck();
      const deals = hasWildCards(variant) ? WILD_DEALS : DEALS;
      for (let i = 0; i < deals; i++) {
        // 同じ札が何枚もあるデッキでは、同じ札が同じオブジェクトとして入っている。
        // どの札を手札・場から使ったかを数えられるよう、配った札を別々のオブジェクトにする（画面も同じことをしている）。
        const dealt = draw(deck, holeCards + boardCards, rng).map((c) => ({ ...c }));
        const hole = dealt.slice(0, holeCards), board = dealt.slice(holeCards);
        const engine = evaluateHand(hole, board, variant);
        const label = `${cardText(hole)} / ${cardText(board)}`;
        expect(engine, `どの役にもならない: ${label}`).not.toBeNull();

        // 使った札は、手札と場から制約どおりの枚数だけ。
        const fromHole = engine!.cards.filter((c) => hole.includes(c)).length;
        const fromBoard = engine!.cards.filter((c) => board.includes(c)).length;
        expect(fromHole + fromBoard, label).toBe(variant.structure.handSize);
        expect(fromHole >= hu.min && fromHole <= hu.max && fromBoard >= bu.min && fromBoard <= bu.max, `使う枚数の制約を破った: ${label}`).toBe(true);

        let best: number[] | null = null;
        for (const five of legalFives(hole, board, variant)) {
          const k = key(five);
          if (best === null || compareRef(k, best) > 0) best = k;
        }
        order.add(best!, engine!, label);
      }
      order.verify();
    }, 120_000);
  }
});

const compareRef = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
};

// ------------------------------------------------------------
// ローカル役：どの役になるかを、役ごとの素朴な判定で確かめる
// ------------------------------------------------------------

const seq = (rank: Rank) => RANKS.indexOf(rank);
const distinctRanks = (cards: readonly Card[]) => new Set(cards.map((c) => c.rank)).size === cards.length;
const sameSuit = (cards: readonly Card[]) => cards.every((c) => c.suit === cards[0]!.suit);
const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';
const sameColor = (cards: readonly Card[]) => cards.every((c) => isRed(c.suit) === isRed(cards[0]!.suit));
/** 2…A の順で連続しているか（端はまたがない）。 */
const consecutive = (cards: readonly Card[]) => {
  if (!distinctRanks(cards)) return false;
  const s = cards.map((c) => seq(c.rank)).sort((a, b) => a - b);
  return s.at(-1)! - s[0]! === cards.length - 1;
};
/** 端をまたいでもよい連続（K の次が A、A の次が 2）。 */
const wrapConsecutive = (cards: readonly Card[]) => {
  if (!distinctRanks(cards)) return false;
  const set = new Set(cards.map((c) => seq(c.rank)));
  return [...set].some((start) => cards.every((_, i) => set.has((start + i) % RANKS.length)));
};
const ranksOf = (cards: readonly Card[]) => cards.map((c) => c.rank);
const onlyRanks = (cards: readonly Card[], allowed: readonly Rank[]) => cards.every((c) => allowed.includes(c.rank));
const anySubset = (cards: readonly Card[], k: number, test: (part: readonly Card[]) => boolean) => subsets(cards, k).some(test);

/** 標準の役を、エンジンの役の id で返す（ロイヤル・ホイールは別の役）。 */
function standardId(five: readonly Card[]): string {
  const key = refKey(five, STANDARD_REF);
  const top = key[1]!;
  switch (key[0]) {
    case 8: return top === 0 ? 'steel_wheel' : top === RANKS.length ? 'royal_flush' : 'straight_flush';
    case 7: return 'four_of_a_kind';
    case 6: return 'full_house';
    case 5: return 'flush';
    case 4: return top === 0 ? 'wheel' : 'straight';
    case 3: return 'three_of_a_kind';
    case 2: return 'two_pair';
    case 1: return 'one_pair';
    default: return 'high_card';
  }
}

/** 足した役の素朴な判定。標準の役はそれ以外の id で、standardId が受け持つ。 */
const LOCAL_TESTS: Readonly<Record<string, (five: readonly Card[]) => boolean>> = {
  mini_straight: (five) => anySubset(five, 3, consecutive),
  pair_plus_run: (five) => anySubset(five, 2, (pair) => pair[0]!.rank === pair[1]!.rank && consecutive(five.filter((c) => !pair.includes(c)))),
  prime: (five) => distinctRanks(five) && onlyRanks(five, ['2', '3', '5', '7', 'J', 'K']),
  big_cat: (five) => distinctRanks(five) && ['K', '8'].every((r) => ranksOf(five).includes(r as Rank)) && onlyRanks(five, ['K', '8', '9', '10', 'J', 'Q']),
  little_cat: (five) => distinctRanks(five) && ['8', '3'].every((r) => ranksOf(five).includes(r as Rank)) && onlyRanks(five, ['8', '3', '4', '5', '6', '7']),
  big_dog: (five) => distinctRanks(five) && ['A', '9'].every((r) => ranksOf(five).includes(r as Rank)) && onlyRanks(five, ['A', '9', '10', 'J', 'Q', 'K']),
  little_dog: (five) => distinctRanks(five) && ['7', '2'].every((r) => ranksOf(five).includes(r as Rank)) && onlyRanks(five, ['7', '2', '3', '4', '5', '6']),
  skeet: (five) => distinctRanks(five) && ['9', '5', '2'].every((r) => ranksOf(five).includes(r as Rank)) && onlyRanks(five, ['9', '5', '2', '3', '4', '6', '7', '8']),
  blaze: (five) => onlyRanks(five, ['J', 'Q', 'K']),
  color_straight: (five) => sameColor(five) && consecutive(five),
  color_flush: (five) => sameColor(five),
  big_bobtail: (five) => anySubset(five, 4, (part) => sameSuit(part) && consecutive(part)),
  four_flush: (five) => anySubset(five, 4, sameSuit),
  four_straight: (five) => anySubset(five, 4, consecutive),
  wrap_straight: (five) => wrapConsecutive(five),
  wrap_straight_flush: (five) => sameSuit(five) && wrapConsecutive(five),
};

/** ルールの役の並びで、最初に成立する役の id（素朴な判定）。 */
function expectedId(five: readonly Card[], variant: Variant): string {
  const standard = standardId(five);
  const standardIndex = variant.ranking.hands.findIndex((h) => h.id === standard);
  for (const [index, hand] of variant.ranking.hands.entries()) {
    if (!hand.enabled) continue;
    if (index === standardIndex) return standard;
    const test = LOCAL_TESTS[hand.id];
    if (test?.(five)) return hand.id;
  }
  return standard;
}

describe('ローカル役は、役ごとの素朴な判定と同じ役になる', () => {
  for (const variant of [HOUSE_HANDS, PRIME_RULES, SKEETS_AND_DOGS, BLAZE, RED_AND_BLACK, BOBTAIL, WRAPAROUND]) {
    it(variant.name, () => {
      const unknown = variant.ranking.hands.filter((h) => LOCAL_TESTS[h.id] === undefined && !STANDARD_IDS.has(h.id));
      expect(unknown.map((h) => h.id), '判定を書いていない役がある').toEqual([]);
      const deck = buildDeck(variant.deck);
      const rng = createRng(41);
      const hits = new Set<string>();
      for (let i = 0; i < SAMPLES; i++) {
        // 足した役はめったに出ないので、半分は狙った札だけから引く。
        const pool = i % 2 === 0 ? deck : biasedPool(variant, deck, rng);
        const five = draw(pool, 5, rng);
        const engine = evaluateExact(five, variant);
        expect(engine?.rankingId, cardText(five)).toBe(expectedId(five, variant));
        hits.add(engine!.rankingId);
      }
      // 足した役が一度も出ないなら、テストが役を踏めていない。
      const added = variant.ranking.hands.filter((h) => h.enabled && !STANDARD_IDS.has(h.id)).map((h) => h.id);
      expect(added.filter((id) => !hits.has(id)), '一度も出なかった役').toEqual([]);
    }, 60_000);
  }
});

const STANDARD_IDS = new Set(STANDARD_VARIANT.ranking.hands.map((h) => h.id));

/** 足した役が出やすい札の山。役で使うランクやスートに寄せる。 */
function biasedPool(variant: Variant, deck: readonly Card[], rng: () => number): readonly Card[] {
  const added = variant.ranking.hands.filter((h) => !STANDARD_IDS.has(h.id));
  const hand = added[Math.floor(rng() * added.length)]!;
  const ranks = new Set<Rank>();
  for (const cond of hand.pattern.cards) {
    if (cond.rank.type === 'fixed') ranks.add(cond.rank.value);
    if (cond.rank.type === 'oneOf') for (const r of cond.rank.values) ranks.add(r);
  }
  // 連続の役は、どこかの6ランクに絞る（回り込みのため端をまたぐ窓も選ぶ）。
  if (ranks.size === 0) {
    const start = Math.floor(rng() * RANKS.length);
    for (let i = 0; i < 6; i++) ranks.add(RANKS[(start + i) % RANKS.length]!);
  }
  const suits: Suit[] = rng() < 0.5 ? ['spades', 'hearts', 'diamonds', 'clubs'] : rng() < 0.5 ? ['hearts', 'diamonds'] : ['spades'];
  const pool = deck.filter((c) => ranks.has(c.rank) && suits.includes(c.suit));
  return pool.length >= 5 ? pool : deck;
}

// ------------------------------------------------------------
// 変えても結果が変わらないはずの操作
// ------------------------------------------------------------

/** スートの入れ替え。♠↔♥・♦↔♣ は色も「片目のジャック」も保つ。 */
const SWAPS: readonly Readonly<Record<Suit, Suit>>[] = [
  { spades: 'hearts', hearts: 'spades', diamonds: 'clubs', clubs: 'diamonds' },
  { spades: 'clubs', clubs: 'spades', hearts: 'diamonds', diamonds: 'hearts' },
  { spades: 'diamonds', diamonds: 'hearts', hearts: 'clubs', clubs: 'spades' },
];

/** そのルールで、スートの入れ替えが結果を変えないはずか。 */
function swapKeepsMeaning(variant: Variant, swap: Readonly<Record<Suit, Suit>>): boolean {
  if (variant.deck.suitRanking) return false;
  const preservesColor = SUITS_ALL.every((s) => isRed(s) === isRed(swap[s]));
  const usesColor = variant.ranking.hands.some((h) => h.pattern.global.some((g) => g.type === 'allSameColor' || g.type === 'color' || g.type === 'colorCount'));
  if (usesColor && !preservesColor) return false;
  const suitSpecific = variant.ranking.hands.some((h) => h.pattern.cards.some((c) => c.suits.length > 0));
  if (suitSpecific) return false;
  const cardWild = (variant.ranking.wilds ?? []).some((w) => w.cards.kind === 'card');
  if (cardWild && swap.spades !== 'hearts') return false;
  return true;
}
const SUITS_ALL: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

const swapCard = (card: Card, swap: Readonly<Record<Suit, Suit>>): Card =>
  card.joker !== undefined ? card : { ...card, suit: swap[card.suit] };

describe('すべてのプリセットで、結果が変わらないはずの操作をしても変わらない', () => {
  for (const variant of VARIANT_PRESETS) {
    it(variant.name, () => {
      const deck = buildDeck(variant.deck);
      const holeCards = variant.structure.holeCards;
      const boardCards = boardSize(variant.structure);
      const rng = createRng(53);
      for (let i = 0; i < (hasWildCards(variant) ? 10 : 40) * SCALE; i++) {
        const dealt = draw(deck, holeCards + boardCards, rng);
        const hole = dealt.slice(0, holeCards), board = dealt.slice(holeCards);
        const label = `${cardText(hole)} / ${cardText(board)}`;
        const base = evaluateHand(hole, board, variant);
        expect(base, `どの役にもならない: ${label}`).not.toBeNull();

        // 並べ替えても同じ。
        const shuffled = evaluateHand(draw(hole, hole.length, rng), draw(board, board.length, rng), variant)!;
        expect(compareHands(shuffled, base!), `並べ替えで結果が変わった: ${label}`).toBe(0);
        expect(shuffled.rankingId, label).toBe(base!.rankingId);

        // スートを入れ替えても同じ（スートに意味があるルールは除く）。
        for (const swap of SWAPS) {
          if (!swapKeepsMeaning(variant, swap)) continue;
          const swapped = evaluateHand(hole.map((c) => swapCard(c, swap)), board.map((c) => swapCard(c, swap)), variant)!;
          expect(compareHands(swapped, base!), `スートの入れ替えで結果が変わった: ${label}`).toBe(0);
        }

        // 場に札が増えて使い道が増えても、弱くはならない（使う枚数に上限が無いルールだけ）。
        if (variant.structure.boardUsage === undefined && board.length < deck.length - dealt.length) {
          const extra = draw(deck.filter((c) => !dealt.includes(c)), 1, rng);
          const more = evaluateHand(hole, [...board, ...extra], variant)!;
          expect(compareHands(more, base!), `場が増えて弱くなった: ${label} + ${cardText(extra)}`).toBeGreaterThanOrEqual(0);
        }
      }
    }, 60_000);
  }
});

describe('スートに強弱があるルール', () => {
  it('同じ強さになるのは、ランクもスートもまったく同じ5枚だけ', () => {
    const deck = buildDeck(SUIT_RANKED.deck);
    const rng = createRng(61);
    for (let i = 0; i < SAMPLES; i++) {
      const a = draw(deck, 5, rng), b = draw(deck, 5, rng);
      const ea = evaluateExact(a, SUIT_RANKED)!, eb = evaluateExact(b, SUIT_RANKED)!;
      if (compareHands(ea, eb) !== 0) continue;
      const text = (cards: readonly Card[]) => cards.map((c) => `${c.rank}${c.suit}`).sort().join(' ');
      expect(text(a), `${cardText(a)} と ${cardText(b)} が引き分け`).toBe(text(b));
    }
  });

  it('スートを無視すれば、強弱のない標準のルールと同じ段階になる', () => {
    const deck = buildDeck(SUIT_RANKED.deck);
    const rng = createRng(67);
    for (let i = 0; i < SAMPLES; i++) {
      const five = draw(deck, 5, rng);
      expect(evaluateExact(five, SUIT_RANKED)!.rankingId, cardText(five)).toBe(evaluateExact(five, STANDARD_VARIANT)!.rankingId);
    }
  });
});
