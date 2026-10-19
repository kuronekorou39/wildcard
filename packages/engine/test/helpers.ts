import type { Card, Rank, Suit } from '../src/types.js';

const SUIT_LETTERS: Record<string, Suit> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

/** "As" / "Ts" / "10s" を Card に変換する。T は 10 の略記。 */
export function card(notation: string): Card {
  const suitLetter = notation.slice(-1);
  const suit = SUIT_LETTERS[suitLetter];
  if (!suit) throw new Error(`不正なスート: ${notation}`);
  const raw = notation.slice(0, -1);
  const rank = (raw === 'T' ? '10' : raw) as Rank;
  return { rank, suit };
}

/** "As Ks Qs" をまとめて変換する。 */
export function cards(notation: string): Card[] {
  return notation.trim().split(/\s+/).map(card);
}
