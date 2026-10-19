import type { Card, DeckRules, Rank, Suit } from './types.js';
import { createRng } from './rng.js';

const keyOf = (rank: Rank, suit: Suit) => `${rank}/${suit}`;

/**
 * デッキを組む。
 *
 * 「スート × ランク × copies」の直積を土台にして、overrides でカード単位に
 * 上書きする。この2段構えなら、素直な52枚も、スペードのAが10枚あるような
 * 偏ったデッキも、同じ型で書ける（→ docs/variants.md）。
 */
export function buildDeck(rules: DeckRules): Card[] {
  const counts = new Map<string, { card: Card; count: number }>();
  const copies = rules.copies ?? 1;

  for (const suit of rules.suits) {
    for (const rank of rules.ranks) {
      counts.set(keyOf(rank, suit), { card: { rank, suit }, count: copies });
    }
  }

  for (const override of rules.overrides ?? []) {
    counts.set(keyOf(override.rank, override.suit), {
      card: { rank: override.rank, suit: override.suit },
      count: Math.max(0, Math.floor(override.count)),
    });
  }

  const cards: Card[] = [];
  for (const { card, count } of counts.values()) {
    for (let i = 0; i < count; i++) cards.push(card);
  }
  return cards;
}

/**
 * Fisher-Yates。seed を受け取るので決定的。
 * 入力配列は変更せず、新しい配列を返す。
 */
export function shuffle<T>(cards: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // noUncheckedIndexedAccess のため非nullを明示
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** ランクの強さ。DeckRules.ranks の並び順がそのまま強さになる。 */
export function rankValue(rank: Rank, rules: DeckRules): number {
  const i = rules.ranks.indexOf(rank);
  if (i < 0) throw new Error(`ランク ${rank} はこのデッキに含まれていない`);
  return i;
}

/**
 * スートの強さ。suitRanking 未指定なら 0 を返す（＝スートに強弱なし）。
 * 強いほど大きい値。
 */
export function suitValue(suit: Suit, rules: DeckRules): number {
  if (!rules.suitRanking) return 0;
  const i = rules.suitRanking.indexOf(suit);
  if (i < 0) return 0;
  return rules.suitRanking.length - 1 - i;
}
