import type { Card, HandPattern, Rank, Suit, Variant } from '../types.js';
import { buildDeck, cardKey, rankValue } from '../deck.js';
import { createRng } from '../rng.js';
import { evaluateExact } from './evaluate.js';
import { hasWilds, isWild } from './wild.js';

/**
 * 役の「具体例」を作る。
 *
 * 条件式（X, X, Y, Y+1, Y+2）を見ても、人間は「で、それ何の手?」が分からない。
 * 編集画面はこれが無いと使えない。旧 poker-web-20250702 が
 * HouseRulesPage.tsx を3,651行まで膨らませて未完に終わったのも、
 * まさにここを作ろうとしていた途中だった。
 *
 * ## 今回が安く済む理由
 *
 * **候補を作って、既存の matchPattern / evaluateExact で確かめる。**
 * 生成側に「成立するか」の判断を持たせないので、判定ロジックと
 * 二重管理にならない。旧実装は生成を独立に書いたため、両者が
 * 食い違いうる構造になっていた。
 *
 * もう一つ大事なのは **「その役より強い役に当てはまらない」ことまで確かめる**
 * 点。これが無いと「ミニストレートの例」としてロイヤルフラッシュを出してしまう。
 * evaluateExact は強い順に見て最初に成立したものを返すので、
 * 返ってきた id が目的の役と一致すれば、それだけで条件を満たしている。
 */

/** 例を探す試行回数。1回あたり評価1回ぶんなので、多くても安い。 */
const MAX_ATTEMPTS = 400;

export interface ExampleOptions {
  /** 乱数の種。変えると別の例が出る。 */
  readonly seed?: number;
}

/**
 * その役がちょうど成立する手を1つ返す。見つからなければ null。
 *
 * 「ちょうど」というのは、**それより強い役には当てはまらない**という意味。
 */
export function exampleHand(
  variant: Variant,
  rankingId: string,
  options: ExampleOptions = {},
): Card[] | null {
  const ranking = variant.ranking.hands.find((h) => h.id === rankingId);
  if (!ranking || !ranking.enabled) return null;

  const { handSize } = variant.structure;
  const available = deckCounts(variant);
  const wilds = wildStock(variant);
  const rng = createRng((options.seed ?? 1) >>> 0);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hand = buildCandidate(variant, ranking.pattern, handSize, available, wilds, rng);
    if (!hand) continue;

    // 生成側では「成立するか」を判断しない。本物の評価に聞く。
    const result = evaluateExact(hand, variant);
    if (result?.rankingId === rankingId) return hand;
  }
  return null;
}

/** 有効な役それぞれの例。順位表に並べて見せるためのもの。 */
export function exampleHands(
  variant: Variant,
  options: ExampleOptions = {},
): Map<string, Card[] | null> {
  const out = new Map<string, Card[] | null>();
  for (const [i, ranking] of variant.ranking.hands.entries()) {
    if (!ranking.enabled) continue;
    // 役ごとに種をずらす。同じ種だと似た例ばかりになる。
    out.set(ranking.id, exampleHand(variant, ranking.id, { seed: (options.seed ?? 1) + i * 97 }));
  }
  return out;
}

// ============================================================
// 候補を作る
// ============================================================

/**
 * デッキにあるワイルドの札。
 *
 * ファイブカードのように、**ワイルドが無いと成立しない役**がある
 * （同じランクは4枚しかない）。実札で足りないときはここから補う。
 */
function wildStock(variant: Variant): Card[] {
  if (!hasWilds(variant)) return [];
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of buildDeck(variant.deck)) {
    if (!isWild(card, variant)) continue;
    const key = cardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/** デッキに各カードが何枚あるか。例に同じ札を使いすぎないため。 */
function deckCounts(variant: Variant): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of buildDeck(variant.deck)) {
    const key = cardKey(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const pick = <T>(list: readonly T[], rng: () => number): T | undefined =>
  list.length === 0 ? undefined : list[Math.floor(rng() * list.length)];

/** 先頭をランダムにずらした並び。どれを先に試すかだけを無作為にする。 */
function rotate<T>(list: readonly T[], rng: () => number): T[] {
  const at = Math.floor(rng() * list.length);
  return [...list.slice(at), ...list.slice(0, at)];
}

function buildCandidate(
  variant: Variant,
  pattern: HandPattern,
  handSize: number,
  available: ReadonlyMap<string, number>,
  wilds: readonly Card[],
  rng: () => number,
): Card[] | null {
  const { ranks, suits } = variant.deck;
  if (ranks.length === 0 || suits.length === 0) return null;

  // 同じ名前の変数は同じランクを指し、違う名前は違うランクを指す。
  const bases = new Map<string, number>();
  const usedBases = new Set<number>();

  const resolveBase = (name: string, offset: number): number | null => {
    const existing = bases.get(name);
    if (existing !== undefined) return existing;

    // offset のぶん上に札が要るので、はみ出さない範囲から選ぶ。
    const maxOffset = Math.max(
      ...pattern.cards
        .filter((c) => c.rank.type === 'variable' && c.rank.name === name)
        .map((c) => (c.rank.type === 'variable' ? (c.rank.offset ?? 0) : 0)),
    );
    const candidates = ranks
      .map((_, i) => i)
      .filter((i) => i + maxOffset < ranks.length && !usedBases.has(i));
    const base = pick(candidates, rng);
    if (base === undefined) return null;

    bases.set(name, base);
    usedBases.add(base);
    return base;
  };

  // 同一スート条件があるなら、全部そのスートで揃える。
  const sameSuit = pattern.global.some((g) => g.type === 'allSameSuit');
  const lockedSuit = sameSuit ? pick(suits, rng) : undefined;

  const used = new Map<string, number>();
  const take = (card: Card): boolean => {
    const key = cardKey(card);
    const have = available.get(key) ?? 0;
    const taken = used.get(key) ?? 0;
    if (taken >= have) return false;
    used.set(key, taken + 1);
    return true;
  };

  const hand: Card[] = [];

  for (const cond of pattern.cards) {
    const allowedSuits = cond.suits.length > 0 ? cond.suits : suits;
    if (allowedSuits.length === 0) return null;
    if (lockedSuit !== undefined && !allowedSuits.includes(lockedSuit)) return null;

    // 条件を満たす札を1つに決め打ちせず、空いているものを順に試す。
    // 1つ試して諦めると「フォーカードなのに3枚しか揃っていない」
    // 「フラッシュなのにジョーカー頼み」といった読めない例になる。
    let rankOrder: Rank[];
    switch (cond.rank.type) {
      case 'fixed':
        rankOrder = ranks.includes(cond.rank.value) ? [cond.rank.value] : [];
        break;
      case 'oneOf':
        rankOrder = rotate(
          cond.rank.values.filter((r) => ranks.includes(r)),
          rng,
        );
        break;
      case 'variable': {
        const base = resolveBase(cond.rank.name, cond.rank.offset ?? 0);
        if (base === null) return null;
        const resolved = ranks[base + (cond.rank.offset ?? 0)];
        // 同じ変数は同じランクを指すので、ここは代案を出せない。
        rankOrder = resolved === undefined ? [] : [resolved];
        break;
      }
      case 'any':
        rankOrder = rotate(ranks, rng);
        break;
    }
    if (rankOrder.length === 0) return null;

    const suitOrder = lockedSuit !== undefined ? [lockedSuit] : rotate(allowedSuits, rng);
    const card = rankOrder.flatMap((rank) => suitOrder.map((suit) => ({ rank, suit }))).find(take);
    if (card) {
      hand.push(card);
      continue;
    }

    // 条件を満たす実札が1枚も残っていない。ワイルドがあるなら代わりに使う。
    // ファイブカードのように、これが無いと作れない役がある。
    const wild = wilds.find(take);
    if (!wild) return null;
    hand.push(wild);
  }

  // 残りはキッカー。役を強くしてしまわないよう、
  // 同じランクや同じスートが重ならないものを優先する。
  const fillers = fillerCandidates(variant, hand, available, used);
  while (hand.length < handSize) {
    const card = pick(fillers, rng);
    if (card === undefined) return null;
    if (!take(card)) {
      // もう取れない札。候補から外して続ける。
      const i = fillers.indexOf(card);
      if (i >= 0) fillers.splice(i, 1);
      continue;
    }
    hand.push(card);
  }

  return hand;
}

/**
 * キッカーの候補。
 *
 * 適当に埋めると、たまたまペアやフラッシュになって「もっと強い役」に
 * なってしまい、やり直しが増える。最初から当たりにくい札を選んでおく。
 */
function fillerCandidates(
  variant: Variant,
  hand: readonly Card[],
  available: ReadonlyMap<string, number>,
  used: ReadonlyMap<string, number>,
): Card[] {
  const { ranks, suits } = variant.deck;
  const usedRanks = new Set(hand.map((c) => c.rank));
  const usedSuits = new Set(hand.map((c) => c.suit));

  const all: Card[] = [];
  for (const rank of ranks) {
    for (const suit of suits) {
      const card = { rank, suit };
      const key = cardKey(card);
      if ((used.get(key) ?? 0) >= (available.get(key) ?? 0)) continue;
      all.push(card);
    }
  }

  /** 手札と噛み合いにくいほど良い。 */
  const score = (card: Card): number => {
    let n = 0;
    if (usedRanks.has(card.rank)) n += 4; // ペアを作ってしまう
    if (usedSuits.size < suits.length && usedSuits.has(card.suit)) n += 1; // フラッシュに寄る
    const near = hand.some(
      (c) => Math.abs(rankValue(c.rank, variant.deck) - rankValue(card.rank, variant.deck)) <= 2,
    );
    if (near) n += 2; // ストレートに寄る
    return n;
  };

  return all.sort((a, b) => score(a) - score(b)).slice(0, 12);
}

// ============================================================
// 条件を日本語にする
// ============================================================

/** 役の条件を一文で説明する。 */
export function describePattern(pattern: HandPattern): string {
  const parts: string[] = [];

  // 同じ変数名のまとまりごとにまとめる。X,X,X なら「同じランクが3枚」。
  const groups = new Map<string, number[]>();
  const fixedRanks: Rank[] = [];
  const oneOfParts: string[] = [];
  let anyCount = 0;

  for (const cond of pattern.cards) {
    switch (cond.rank.type) {
      case 'variable': {
        const list = groups.get(cond.rank.name) ?? [];
        list.push(cond.rank.offset ?? 0);
        groups.set(cond.rank.name, list);
        break;
      }
      case 'fixed':
        fixedRanks.push(cond.rank.value);
        break;
      case 'oneOf':
        oneOfParts.push(cond.rank.values.join('・'));
        break;
      case 'any':
        anyCount++;
        break;
    }
  }

  for (const offsets of groups.values()) {
    const sorted = [...offsets].sort((a, b) => a - b);
    const allZero = sorted.every((o) => o === 0);
    const consecutive = sorted.every((o, i) => o === i);

    if (allZero) parts.push(`同じランクが${sorted.length}枚`);
    else if (consecutive) parts.push(`連続する${sorted.length}枚`);
    else parts.push(`決まった間隔の${sorted.length}枚`);
  }

  if (fixedRanks.length > 0) parts.push(`${fixedRanks.join(' ')} の${fixedRanks.length}枚`);
  if (oneOfParts.length > 0) {
    // 同じ候補が並ぶのが普通なので、一度だけ書く。
    const unique = [...new Set(oneOfParts)];
    parts.push(`${unique.join(' / ')} から${oneOfParts.length}枚`);
  }
  if (anyCount > 0) parts.push(`任意の${anyCount}枚`);

  for (const global of pattern.global) {
    switch (global.type) {
      case 'allSameSuit':
        parts.push('すべて同じスート');
        break;
      case 'allDifferentSuit':
        parts.push('すべて違うスート');
        break;
      case 'suitCount':
        parts.push(`同じスートが${global.count}枚以上`);
        break;
      case 'consecutive':
        parts.push('ランクが連続');
        break;
      case 'allDifferentRank':
        parts.push('すべて違うランク');
        break;
    }
  }

  return parts.length > 0 ? parts.join('、') : '条件なし';
}

/** スートの一覧を日本語にする。 */
export const describeSuits = (suits: readonly Suit[]): string =>
  suits.map((s) => SUIT_NAME[s]).join('・');

const SUIT_NAME: Record<Suit, string> = {
  spades: 'スペード',
  hearts: 'ハート',
  diamonds: 'ダイヤ',
  clubs: 'クラブ',
};
