import { describe, expect, it } from 'vitest';
import { createGame, project, reduce, legalActions } from '@wildcard/engine';
import { showdownWinners } from '../src/components/ShowdownResult.js';

describe('勝者と役名', () => {
  it('未コール分の返却を獲得額から除き、非公開の手の役は推測しない', () => {
    let state = createGame({ seatCount: 2, smallBlind: 10, bigBlind: 20 });
    for (let seat = 0; seat < 2; seat++) state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: `P${seat}`, seat, chips: 1000 });
    state = reduce(state, { type: 'startHand', seed: 2 });
    const winner = state.turnPlayerId!;
    state = reduce(state, { type: 'raise', playerId: winner, to: 200 });
    state = reduce(state, { type: 'fold', playerId: state.turnPlayerId! });
    expect(state.summary!.payouts).toEqual([{ playerId: winner, amount: 220 }]);
    expect(state.summary!.awards).toEqual([{ playerId: winner, amount: 40 }]);
    expect(showdownWinners(project(state, null))).toEqual([{ playerId: winner, amount: 40, name: winner === 'p0' ? 'P0' : 'P1', ranking: '全員フォールド' }]);
  });
  it('公開された役名を使い、全てのポット獲得者を表示する', () => {
    let state = createGame({ seatCount: 3 });
    for (let seat = 0; seat < 3; seat++) state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: `P${seat}`, seat, chips: 1000 });
    state = reduce(state, { type: 'startHand', seed: 7 });
    for (let step = 0; state.phase !== 'showdown' && step < 30; step++) {
      const playerId = state.turnPlayerId!;
      state = reduce(state, { type: legalActions(state, playerId)!.canCheck ? 'check' : 'call', playerId });
    }
    const winners = showdownWinners(project(state, null));
    expect(winners.length).toBeGreaterThan(0);
    expect(winners.map(w => w.playerId)).toEqual(state.summary!.awards!.map(w => w.playerId));
    for (const winner of winners) expect(winner.ranking).toBe(state.summary!.revealed.find(h => h.playerId === winner.playerId)!.rankingName);
  });
});
