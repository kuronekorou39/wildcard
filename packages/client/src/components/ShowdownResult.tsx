import { useState } from 'react';
import type { Card, VisibleState } from '@wildcard/engine';
import { evaluateHand } from '@wildcard/engine';
import { showdownSelections } from '../showdownSelection.js';
import { describeHand } from '../handDescription.js';
import { Icon } from './Icon.js';

/** The engine distinguishes winning a pot from getting an uncalled bet back. */
export function showdownWinners(state: VisibleState) {
  const summary = state.summary;
  if (!summary) return [];
  /** 役の名前に、揃った札・キッカー・ワイルドの化け先を添える。 */
  const words = (holeCards: readonly Card[], board: readonly Card[], fallback: string) => {
    const result = evaluateHand(holeCards, board, state.variant);
    if (!result) return fallback;
    const { main, detail } = describeHand(result, state.variant);
    return detail ? `${main} · ${detail}` : main;
  };
  return (summary.awards ?? summary.payouts).filter(p => p.amount > 0).map(payout => {
    const name = state.players.find(p => p.id === payout.playerId)?.name ?? payout.playerId;
    const ranks = summary.runs
      ? summary.runs.flatMap((run, i) => {
        const hand = run.revealed.find(h => h.playerId === payout.playerId);
        return hand && run.payouts.some(p => p.playerId === payout.playerId && p.amount > 0) ? [`${i + 1}本目 ${words(hand.holeCards, run.board, hand.rankingName)}`] : [];
      })
      : [(() => {
        const hand = summary.revealed.find(h => h.playerId === payout.playerId);
        return hand ? words(hand.holeCards, state.communityCards, hand.rankingName) : '全員フォールド';
      })()];
    return { ...payout, name, ranking: ranks.join(' / ') };
  });
}

export function ShowdownResult({ state, selectedIndex, onSelect }: { readonly state: VisibleState; readonly selectedIndex?: number; readonly onSelect?: (index: number) => void }) {
  const winners = showdownSelections(state);
  const [index, setIndex] = useState(0);
  const current = (selectedIndex ?? index) % winners.length;
  const winner = winners[current];
  if (!winner) return null;
  return <div className="showdown-result" role="status" aria-label={winners.map(w => `${w.name} 勝利、${w.ranking}${w.detail ? `、${w.detail}` : ''}、${w.amount.toLocaleString()}獲得`).join('。')}>
    <div className="winner-caption"><span>WINNER</span>{winners.length > 1 && <button type="button"
      onClick={() => onSelect ? onSelect(current + 1) : setIndex(i => i + 1)} aria-label="次の獲得者">{current + 1}/{winners.length} <Icon kind="arrow-right" /></button>}</div>
    <strong className="winner-name" title={winner.name}>{winner.name}</strong>
    <span className="winner-ranking">{winner.ranking}</span>
    {winner.detail && <span className="winner-detail">{winner.detail}</span>}
    <strong className="winner-amount">+{winner.amount.toLocaleString()}</strong>
  </div>;
}
