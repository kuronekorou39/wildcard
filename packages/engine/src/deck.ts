import type { Card, DeckRules, Rank, Suit } from './types.js';
import { createRng } from './rng.js';

/**
 * RuleSet のデッキ定義からデッキを組む。
 *
 * スートやランクを減らした変則デッキもここで素直に表現される
 * ——「ルールは設定データである」（原則4）の最初の現れ。
 */
export function buildDeck(rules: DeckRules): Card[] {
  const cards: Card[] = [];
  for (const suit of rules.suits) {
    for (const rank of rules.ranks) {
      cards.push({ rank, suit });
    }
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
  if (i < 0) throw new Error(`ランク ${rank} はこのルールセットのデッキに含まれていない`);
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
