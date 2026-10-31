import { expect, it } from 'vitest';
import { buildDeck, STANDARD_VARIANT } from '@wildcard/engine';
import { cardCount, setCardCount } from '../src/components/DeckContents.js';
import { cpuStyles } from '../src/cpuStyles.js';

it('per-card overrides change the real deck and reset to the current shared count', () => {
  let deck = setCardCount(STANDARD_VARIANT.deck, '9', 'hearts', 3);
  expect(buildDeck(deck)).toHaveLength(54);
  expect(buildDeck(deck).filter(c => c.rank === '9' && c.suit === 'hearts')).toHaveLength(3);
  deck = { ...deck, copies: 2 };
  expect(cardCount(deck, '9', 'hearts')).toBe(3);
  deck = setCardCount(deck, '9', 'hearts', null);
  expect(cardCount(deck, '9', 'hearts')).toBe(2);
  deck = setCardCount(deck, '9', 'hearts', 0);
  expect(buildDeck(deck).some(c => c.rank === '9' && c.suit === 'hearts')).toBe(false);
});
it('mixed CPUs stay balanced and stable for a table seed, with uniform styles still available', () => {
  for (let count = 1; count <= 9; count++) {
    const styles = cpuStyles(count, 52);
    expect(styles).toEqual(cpuStyles(count, 52));
    expect(styles).toHaveLength(count);
    const distribution = [.15, .5, .85].map(aggression => styles.filter(s => s.aggression === aggression).length);
    expect(Math.max(...distribution) - Math.min(...distribution)).toBeLessThanOrEqual(1);
  }
  expect(cpuStyles(9, 1, .85).every(s => s.aggression === .85)).toBe(true);
});
