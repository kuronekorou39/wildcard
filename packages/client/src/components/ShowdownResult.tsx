import { useState } from 'react';
import type { VisibleState } from '@wildcard/engine';

/** The engine distinguishes winning a pot from getting an uncalled bet back. */
export function showdownWinners(state: VisibleState) {
  const summary = state.summary;
  if (!summary) return [];
  return (summary.awards ?? summary.payouts).filter(p => p.amount > 0).map(payout => {
    const name = state.players.find(p => p.id === payout.playerId)?.name ?? payout.playerId;
    const ranks = summary.runs
      ? summary.runs.flatMap((run, i) => {
        const hand = run.revealed.find(h => h.playerId === payout.playerId);
        return hand && run.payouts.some(p => p.playerId === payout.playerId && p.amount > 0) ? [`${i + 1}本目 ${hand.rankingName}`] : [];
      })
      : [summary.revealed.find(h => h.playerId === payout.playerId)?.rankingName ?? '全員フォールド'];
    return { ...payout, name, ranking: ranks.join(' / ') };
  });
}

export function ShowdownResult({ state }: { readonly state: VisibleState }) {
  const winners = showdownWinners(state);
  const [index, setIndex] = useState(0);
  const winner = winners[index % winners.length];
  if (!winner) return null;
  return <div className="showdown-result" role="status" aria-label={winners.map(w => `${w.name} 勝利、${w.ranking}、${w.amount.toLocaleString()}獲得`).join('。')}>
    <div className="winner-caption"><span>WINNER</span>{winners.length > 1 && <button type="button"
      onClick={() => setIndex(i => i + 1)} aria-label="次の獲得者">{index % winners.length + 1}/{winners.length} →</button>}</div>
    <strong className="winner-name" title={winner.name}>{winner.name}</strong>
    <span className="winner-ranking">{winner.ranking}</span>
    <strong className="winner-amount">+{winner.amount.toLocaleString()}</strong>
  </div>;
}
