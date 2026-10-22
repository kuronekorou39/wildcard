import type { TableRuntimeSnapshot } from './transport/tableRuntime.js';
import { addChips, contributedChips, subtractChips, TABLE_TIMING as T, type PostedBet } from './transport/presentation.js';

/** Preserve denomination counts while chips move from a player, to a bet, to the pot. */
export function presentedChips(runtime: TableRuntimeSnapshot, now: number) {
  const pending = runtime.events.filter(e => e.kind === 'collect' && now < e.at + T.collect);
  const uncollected = [...runtime.bets, ...pending.flatMap(e => e.kind === 'collect' ? e.bets : [])];
  const pot = subtractChips(runtime.potChips, uncollected.flatMap(bet => bet.chips));
  const posted = [...runtime.bets, ...pending.flatMap(e => e.kind === 'collect' && now < e.at ? e.bets : [])];
  const bets: PostedBet[] = [];
  for (const bet of posted) {
    const prior = bets.find(b => b.playerId === bet.playerId);
    if (prior) bets.splice(bets.indexOf(prior), 1);
    bets.push({ playerId: bet.playerId, chips: addChips(prior?.chips ?? [], bet.chips) });
  }
  return { pot, bets: bets.map(bet => ({ ...bet, chips: subtractChips(bet.chips,
    runtime.events.flatMap(e => e.kind === 'bet' && e.playerId === bet.playerId && now < e.at + T.bet ? contributedChips(e.amount) : [])) })) };
}
