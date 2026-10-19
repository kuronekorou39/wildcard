import { describe, expect, it } from 'vitest';
import { buildDeck, rankValue, shuffle, suitValue } from '../src/deck.js';
import { RANKS, SUITS, type DeckRules } from '../src/types.js';

const standard: DeckRules = { suits: SUITS, ranks: RANKS };

describe('buildDeck', () => {
  it('標準デッキは52枚で重複がない', () => {
    const deck = buildDeck(standard);
    expect(deck).toHaveLength(52);
    const keys = new Set(deck.map((c) => `${c.rank}${c.suit}`));
    expect(keys.size).toBe(52);
  });

  it('スートを減らすとデッキも縮む（変則デッキ）', () => {
    const deck = buildDeck({ suits: ['spades', 'hearts'], ranks: RANKS });
    expect(deck).toHaveLength(26);
    expect(deck.every((c) => c.suit === 'spades' || c.suit === 'hearts')).toBe(true);
  });

  it('ランクを減らすとデッキも縮む（ショートデッキ）', () => {
    const deck = buildDeck({ suits: SUITS, ranks: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] });
    expect(deck).toHaveLength(36);
    expect(deck.some((c) => c.rank === '5')).toBe(false);
  });
});

describe('shuffle', () => {
  it('同じ seed からは同じ並びが得られる（ハンドの再現性）', () => {
    const deck = buildDeck(standard);
    expect(shuffle(deck, 12345)).toEqual(shuffle(deck, 12345));
  });

  it('異なる seed では並びが変わる', () => {
    const deck = buildDeck(standard);
    expect(shuffle(deck, 1)).not.toEqual(shuffle(deck, 2));
  });

  it('枚数と内容は保存される', () => {
    const deck = buildDeck(standard);
    const shuffled = shuffle(deck, 999);
    expect(shuffled).toHaveLength(deck.length);
    expect([...shuffled].sort(byKey)).toEqual([...deck].sort(byKey));
  });

  it('入力配列を破壊しない', () => {
    const deck = buildDeck(standard);
    const before = deck.slice();
    shuffle(deck, 7);
    expect(deck).toEqual(before);
  });
});

describe('rankValue', () => {
  it('ranks の並び順がそのまま強さになる', () => {
    expect(rankValue('A', standard)).toBeGreaterThan(rankValue('K', standard));
    expect(rankValue('2', standard)).toBe(0);
  });

  it('ランクの強さ順はルールで差し替えられる（A を最弱にする）', () => {
    const aceLow: DeckRules = {
      suits: SUITS,
      ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
    };
    expect(rankValue('A', aceLow)).toBeLessThan(rankValue('2', aceLow));
  });

  it('デッキに無いランクは拒否される', () => {
    const short: DeckRules = { suits: SUITS, ranks: ['K', 'A'] };
    expect(() => rankValue('2', short)).toThrow();
  });
});

describe('suitValue', () => {
  it('suitRanking 未指定ならスートに強弱を付けない', () => {
    expect(suitValue('spades', standard)).toBe(0);
    expect(suitValue('clubs', standard)).toBe(0);
  });

  it('suitRanking を与えると強弱が付く', () => {
    const rules: DeckRules = { ...standard, suitRanking: ['spades', 'hearts', 'diamonds', 'clubs'] };
    expect(suitValue('spades', rules)).toBeGreaterThan(suitValue('clubs', rules));
  });
});

function byKey(a: { rank: string; suit: string }, b: { rank: string; suit: string }): number {
  return `${a.rank}${a.suit}`.localeCompare(`${b.rank}${b.suit}`);
}
