import type { Card, RuleSet } from '../types.js';
import { type PatternMatch, compareTiebreak, matchPattern } from './pattern.js';

export interface HandResult {
  readonly rankingId: string;
  readonly rankingName: string;
  /** RuleSet.handRankings 内の位置。**小さいほど強い**。 */
  readonly rankingIndex: number;
  /** 実際に使った5枚。 */
  readonly cards: readonly Card[];
  readonly matched: readonly Card[];
  readonly kickers: readonly Card[];
  readonly tiebreak: readonly number[];
}

/**
 * 手札（ホールカード＋コミュニティカード）から最強の役を求める。
 *
 * 役の定義はコードではなく RuleSet から来る（原則4）。
 * 標準のテキサスホールデムもまた一つの RuleSet にすぎないため、
 * この関数自体は「標準の役」を一切知らない。
 */
export function evaluateHand(cards: readonly Card[], ruleSet: RuleSet): HandResult | null {
  if (cards.length < 5) return null;

  let best: HandResult | null = null;
  for (const five of combinations(cards, 5)) {
    const result = evaluateExactFive(five, ruleSet);
    if (result && (best === null || compareHands(result, best) > 0)) {
      best = result;
    }
  }
  return best;
}

/** ちょうど5枚に対して、成立する最強の役を返す。 */
export function evaluateExactFive(five: readonly Card[], ruleSet: RuleSet): HandResult | null {
  for (let i = 0; i < ruleSet.handRankings.length; i++) {
    const ranking = ruleSet.handRankings[i]!;
    if (!ranking.enabled) continue;

    const match: PatternMatch | null = matchPattern(five, ranking.pattern, ruleSet.deck);
    if (!match) continue;

    // handRankings は強い順に並んでいるので、最初に成立したものが最強。
    return {
      rankingId: ranking.id,
      rankingName: ranking.name,
      rankingIndex: i,
      cards: five,
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
  if (k > n) return;
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
