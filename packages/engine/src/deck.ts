import type { Card, DeckRules, Rank, Suit } from './types.js';
import { createRng } from './rng.js';

const keyOf = (rank: Rank, suit: Suit) => `${rank}/${suit}`;

/**
 * カードの同一性。
 *
 * ジョーカーは rank と suit に意味がないので、通し番号で区別する。
 * `${rank}${suit}` で比べると、ジョーカーが実在のカードと衝突する。
 */
export const cardKey = (card: Card): string =>
  card.joker === undefined ? `${card.rank}/${card.suit}` : `joker/${card.joker}`;

/** 表示用の仮の値。ジョーカーの rank と suit には意味がない。 */
const JOKER_PLACEHOLDER = { rank: 'A' as Rank, suit: 'spades' as Suit };

/**
 * デッキを組む。
 *
 * 「スート × ランク × copies」の直積を土台にして、overrides でカード単位に
 * 上書きする。この2段構えなら、素直な52枚も、スペードのAが10枚あるような
 * 偏ったデッキも、同じ型で書ける（→ docs/variants.md）。
 */
function deckEntries(rules: DeckRules): Map<string, { card: Card; count: number }> {
  const counts = new Map<string, { card: Card; count: number }>();
  const copies = Math.max(0, Math.floor(rules.copies ?? 1));

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

  return counts;
}

/**
 * デッキの上限。
 *
 * 「スペードのAを10枚」のような偏ったデッキは作れるべきだが、枚数は
 * 数字の入力一つで際限なく増える。標準デッキの20倍近くあり、
 * まともな用途で当たることはない。
 */
export const MAX_DECK_SIZE = 1000;

/**
 * デッキの枚数だけを数える。札は作らない。
 *
 * **編集中のルールに対してはこちらを使う。** 「同じ札を何枚入れるか」は
 * 数字の入力一つなので、1000000 と打たれた瞬間に buildDeck が確保しに行って
 * 画面が固まる。枚数を見てから作るかどうかを決められるようにしてある。
 */
export function deckSize(rules: DeckRules): number {
  let n = rules.jokers ?? 0;
  for (const { count } of deckEntries(rules).values()) n += count;
  return n;
}

export function buildDeck(rules: DeckRules): Card[] {
  const size = deckSize(rules);
  if (size > MAX_DECK_SIZE) {
    // 黙って切り詰めると、配った札が設定と食い違う。
    // 編集中のルールには deckSize を使って、作る前に止めること。
    throw new Error(`デッキが大きすぎる: ${size}枚（上限 ${MAX_DECK_SIZE}枚）`);
  }

  const counts = deckEntries(rules);

  const cards: Card[] = [];
  for (const { card, count } of counts.values()) {
    for (let i = 0; i < count; i++) cards.push(card);
  }

  for (let i = 0; i < (rules.jokers ?? 0); i++) {
    cards.push({ ...JOKER_PLACEHOLDER, joker: i });
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
