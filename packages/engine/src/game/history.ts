import type { Action, Card, GameState, HandHistoryStep } from '../types.js';
import { blindPositions } from './seats.js';
export interface AutomaticFold { readonly playerId: string; readonly streetIndex: number }

/** Record public intermediate states, even when one reducer call runs out several streets. */
export function recordHandHistory(before: GameState, after: GameState, action: Action, automaticFolds: readonly AutomaticFold[] = []): GameState {
  const starting = action.type === 'startHand';
  if (!starting && !['betting', 'runChoice'].includes(before.phase)) return after;
  const history = starting ? [] : [...before.history ?? []];
  let players = (starting ? after.players : before.players).filter(p => starting ? p.inHand
    : before.history?.[0]?.players.some(h => h.id === p.id) ?? p.inHand).map(p => ({
    id: p.id, name: p.name, chips: starting ? before.players.find(b => b.id === p.id)!.chips : p.chips,
    bet: starting ? 0 : before.phase === 'runChoice' ? before.history?.at(-1)?.players.find(b => b.id === p.id)?.bet ?? p.bet : p.bet,
    folded: starting ? false : p.folded, allIn: starting ? false : p.allIn,
  }));
  let boards: readonly (readonly Card[])[] = starting ? [[]] : [before.communityCards, ...before.extraBoards];
  let streetIndex = starting ? -1 : before.streetIndex;
  let pot = starting ? 0 : (history.at(-1)?.pot ?? before.pot - players.reduce((s,p) => s+p.bet,0));
  const append = (step: Omit<HandHistoryStep, 'players' | 'boards' | 'pot' | 'streetIndex'>) =>
    history.push({ ...step, players, boards, pot, streetIndex });
  const update = (id: string, patch: Partial<(typeof players)[number]>) => {
    players = players.map(p => p.id === id ? { ...p, ...patch } : p);
  };
  const ended = after.phase === 'showdown' && before.phase !== 'showdown';
  const paidBy = (id: string) => {
    const a = after.players.find(p => p.id === id)!;
    return ended ? (before.players.find(p => p.id === id)?.chips ?? 0) +
      (after.summary?.payouts.find(p => p.playerId === id)?.amount ?? 0) - a.chips
      : a.committed - (starting ? 0 : before.players.find(p => p.id === id)?.committed ?? 0);
  };
  const pay = (id: string, amount: number) => {
    const p = players.find(p => p.id === id)!;
    update(id, { chips: p.chips - amount, bet: p.bet + amount, allIn: p.chips === amount });
  };
  if (starting) {
    append({ kind: 'deal' });
    const blinds = blindPositions(after.players.filter(p => p.inHand).map(p => p.seat), after.dealerSeat, after.seatCount);
    const order = [...after.players].sort((a,b) =>
      (a.seat - (blinds?.smallBlindSeat ?? 0) + after.seatCount) % after.seatCount -
      (b.seat - (blinds?.smallBlindSeat ?? 0) + after.seatCount) % after.seatCount);
    for (const p of order) {
      const amount = paidBy(p.id);
      if (amount <= 0) continue;
      pay(p.id, amount);
      const blind = p.seat === blinds?.smallBlindSeat ? 'SB' : p.seat === blinds?.bigBlindSeat ? 'BB' : undefined;
      append({ kind: blind ? 'blind' : 'straddle', playerId: p.id, amount, ...(blind ? { blind } : {}) });
    }
  } else if ('playerId' in action) {
    const p = players.find(p => p.id === action.playerId);
    if (p && ['fold','check','call','raise','timeout','runItTwice'].includes(action.type)) {
      const amount = Math.max(0, paidBy(p.id));
      if (amount) pay(p.id, amount);
      const folded = after.players.find(a => a.id === p.id)?.folded ?? p.folded;
      update(p.id, { folded });
      const kind = action.type === 'runItTwice' ? action.agree ? 'run-agree' : 'run-once'
        : action.type === 'timeout' ? before.phase === 'runChoice' ? 'run-once' : folded ? 'timeout-fold' : 'timeout-check'
        : action.type as 'fold' | 'check' | 'call' | 'raise';
      append({ kind, playerId: p.id, ...(amount ? { amount, to: p.bet + amount } : {}) });
    }
  }
  // Includes folds caused by leaving/away, without recording hidden cards or raw actions.
  for (const p of after.players) if (p.folded && players.some(b => b.id === p.id && !b.folded) && !automaticFolds.some(f => f.playerId === p.id)) {
    update(p.id, { folded: true }); append({ kind: 'fold', playerId: p.id });
  }
  const foldAt = (street: number) => {
    for (const fold of automaticFolds.filter(f => f.streetIndex === street)) {
      update(fold.playerId, { folded: true }); append({ kind: 'fold', playerId: fold.playerId });
    }
  };
  foldAt(streetIndex);
  const roundEnded = starting ? after.phase !== 'betting'
    : before.streetIndex !== after.streetIndex || before.phase === 'betting' && after.phase !== 'betting';
  if (roundEnded) {
    const amount = players.reduce((s,p) => s + p.bet,0);
    if (amount) {
      pot += amount; players = players.map(p => ({ ...p, bet: 0 })); append({ kind: 'collect', amount });
    }
  }
  const finalBoards = [after.communityCards, ...after.extraBoards];
  for (let run = 0; run < finalBoards.length; run++) {
    if (!boards[run]) boards = [...boards, before.communityCards];
    let end = 0;
    for (let i = 0; i < after.variant.structure.streets.length; i++) {
      const street = after.variant.structure.streets[i]!; end += street.cards;
      if (end <= boards[run]!.length || end > finalBoards[run]!.length) continue;
      streetIndex = i;
      if (street.burn) append({ kind: 'burn', amount: street.burn, run });
      boards = boards.map((b, index) => index === run ? finalBoards[run]!.slice(0, end) : b);
      append({ kind: 'board', run });
      if (run === 0) foldAt(streetIndex);
    }
  }
  if (ended) {
    const awards = after.summary?.awards ?? after.summary?.payouts ?? [];
    for (const payout of after.summary?.payouts ?? []) {
      const refund = payout.amount - (awards.find(p => p.playerId === payout.playerId)?.amount ?? 0);
      if (refund <= 0) continue;
      const p = players.find(p => p.id === payout.playerId)!;
      pot -= refund; update(p.id, { chips: p.chips + refund, allIn: false });
      append({ kind: 'refund', playerId: p.id, amount: refund });
    }
    for (const payout of awards) {
      const p = players.find(p => p.id === payout.playerId)!;
      pot -= payout.amount; update(p.id, { chips: p.chips + payout.amount, allIn: false });
      append({ kind: 'award', playerId: p.id, amount: payout.amount });
    }
  }
  return history.length === (before.history?.length ?? 0) && !starting ? after : { ...after, history };
}
