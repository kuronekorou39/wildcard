import type { Card, Variant } from '../types.js';
import { boardUsageOf, holeUsageOf } from '../variant.js';
import { type PatternMatch, compareTiebreak, matchPattern } from './pattern.js';

export interface HandResult {
  readonly rankingId: string;
  readonly rankingName: string;
  /** Variant.ranking.hands 内の位置。**小さいほど強い**。 */
  readonly rankingIndex: number;
  /** 実際に使った札。 */
  readonly cards: readonly Card[];
  readonly matched: readonly Card[];
  readonly kickers: readonly Card[];
  readonly tiebreak: readonly number[];
}

/**
 * 手札と場から最強の役を求める。
 *
 * **使用枚数の制約を守る。** ホールデムは「7枚から好きな5枚」だが、
 * オマハは「手札からちょうど2枚 ＋ 場からちょうど3枚」でなければならない。
 * この違いはエンジンの分岐ではなく、Variant の holeUsage / boardUsage という
 * データで表される（→ docs/variants.md）。
 */
export function evaluateHand(
  hole: readonly Card[],
  board: readonly Card[],
  variant: Variant,
): HandResult | null {
  const { handSize } = variant.structure;
  const holeUsage = holeUsageOf(variant.structure);
  const boardUsage = boardUsageOf(variant.structure);

  // 手札から使う枚数 h は、両方の制約と実際の枚数で挟まれる。
  const low = Math.max(holeUsage.min, handSize - boardUsage.max, handSize - board.length);
  const high = Math.min(holeUsage.max, handSize - boardUsage.min, hole.length, handSize);

  let best: HandResult | null = null;
  for (let h = Math.max(0, low); h <= high; h++) {
    const b = handSize - h;
    if (b < 0 || b > board.length) continue;

    for (const fromHole of combinations(hole, h)) {
      for (const fromBoard of combinations(board, b)) {
        const result = evaluateExact([...fromHole, ...fromBoard], variant);
        if (result && (best === null || compareHands(result, best) > 0)) best = result;
      }
    }
  }
  return best;
}

/**
 * 制約を一切かけず、与えられた札から最強の役を探す。
 * 勝率の推定や、手札と場を区別しない場面で使う。
 */
export function evaluateBest(cards: readonly Card[], variant: Variant): HandResult | null {
  const { handSize } = variant.structure;
  if (cards.length < handSize) return null;

  let best: HandResult | null = null;
  for (const picked of combinations(cards, handSize)) {
    const result = evaluateExact(picked, variant);
    if (result && (best === null || compareHands(result, best) > 0)) best = result;
  }
  return best;
}

/** ちょうど handSize 枚に対して、成立する最強の役を返す。 */
export function evaluateExact(cards: readonly Card[], variant: Variant): HandResult | null {
  const hands = variant.ranking.hands;

  for (let i = 0; i < hands.length; i++) {
    const ranking = hands[i]!;
    if (!ranking.enabled) continue;

    const match: PatternMatch | null = matchPattern(cards, ranking.pattern, variant.deck);
    if (!match) continue;

    // hands は強い順に並んでいるので、最初に成立したものが最強。
    return {
      rankingId: ranking.id,
      rankingName: ranking.name,
      rankingIndex: i,
      cards,
      matched: match.matched,
      kickers: match.kickers,
      tiebreak: match.tiebreak,
    };
  }
  return null;
}

/** 正なら a が強い、0 なら完全な引き分け（チョップ）。 */
export function compareHands(a: HandResult, b: HandResult): number {
  if (a.rankingIndex !== b.rankingIndex) {
    // index が小さいほうが強い。
    return b.rankingIndex - a.rankingIndex;
  }
  return compareTiebreak(a.tiebreak, b.tiebreak);
}

/** items から k 枚を選ぶ組み合わせを列挙する（順序は問わない）。 */
export function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  const n = items.length;
  if (k > n || k < 0) return;
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);

  while (true) {
    yield idx.map((i) => items[i]!);

    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i] = idx[i]! + 1;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}
