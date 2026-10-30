import { expect, it } from 'vitest';
import { createGame, reduce, legalActions, type GameState } from '../src/index.js';

function table(stacks = [1000, 1000, 1000], ante = 5) {
  let state = createGame({ seatCount: stacks.length, ante, smallBlind: 10, bigBlind: 20 });
  stacks.forEach((chips, seat) => { state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: `P${seat}`, seat, chips }); });
  return reduce(state, { type: 'startHand', seed: 4 });
}
function complete(state: GameState) {
  for (let i = 0; state.phase !== 'showdown' && i < 50; i++) {
    const playerId = state.turnPlayerId!;
    state = reduce(state, { type: legalActions(state, playerId)!.canCheck ? 'check' : 'call', playerId });
  }
  expect(state.phase).toBe('showdown');
  return state;
}

it('antes go to the center, blinds stay live, and calls do not pay the ante again', () => {
  let state = table();
  expect(state.pot).toBe(45);
  expect(state.players.map(p => [p.chips, p.bet, p.committed])).toEqual([[995, 0, 5], [985, 10, 15], [975, 20, 25]]);
  expect(legalActions(state, 'p0')?.callAmount).toBe(20);
  expect(state.history!.map(step => step.kind)).toEqual(['deal', 'ante', 'ante', 'ante', 'blind', 'blind']);
  expect(state.history!.at(-1)!.pot).toBe(15);
  state = reduce(state, { type: 'call', playerId: 'p0' });
  expect(state.players[0]!.committed).toBe(25);
  expect(state.players[0]!.bet).toBe(20);
});

it('short antes keep players in the hand and preserve every chip through side pots and history', () => {
  for (const stacks of [[2, 1000, 1000], [7, 20, 50], [5, 5, 5], [1000, 1000, 1000]]) {
    const total = stacks.reduce((a, b) => a + b, 0);
    const started = table(stacks);
    expect(started.players.every(p => p.holeCards.length === 2 && p.inHand)).toBe(true);
    const state = complete(started);
    expect(state.players.reduce((sum, p) => sum + p.chips, 0)).toBe(total);
    for (const step of state.history!) {
      expect(step.pot + step.players.reduce((sum, p) => sum + p.chips + p.bet, 0), step.kind).toBe(total);
      expect(step.players.every(p => p.chips >= 0 && p.bet >= 0)).toBe(true);
    }
    expect(state.history!.at(-1)!.pot).toBe(0);
    expect(state.history!.at(-1)!.players.map(p => p.chips)).toEqual(state.players.map(p => p.chips));
  }
});

it('away and busted seats do not pay, and legacy games still have no ante', () => {
  let state = createGame({ seatCount: 4, ante: 5 });
  for (let seat = 0; seat < 4; seat++) state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: 'P', seat, chips: seat === 3 ? 0 : 100 });
  state = reduce(state, { type: 'setAway', playerId: 'p2', away: true });
  const started = reduce(state, { type: 'startHand', seed: 8 });
  expect(started.players.find(p => p.id === 'p2')!.chips).toBe(100);
  expect(started.history!.filter(step => step.kind === 'ante')).toHaveLength(2);
  const { ante: _ante, ...legacy } = state;
  expect(reduce(legacy, { type: 'startHand', seed: 8 }).history!.some(step => step.kind === 'ante')).toBe(false);
  for (const ante of [-1, 1.5, NaN, Infinity]) expect(() => createGame({ ante })).toThrow();
});
