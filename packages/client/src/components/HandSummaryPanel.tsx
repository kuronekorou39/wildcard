import { useState } from 'react';
import { evaluateHand, type VisibleState } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';
import { HandHistory } from './HandHistory.js';
import { usesCard } from '../showdownSelection.js';

interface HandSummaryPanelProps {
  readonly state: VisibleState;
  readonly onNextHand: () => void;
  readonly canStartNextHand: boolean;
  readonly blockedReason: string | null;
  readonly showNextHand?: boolean;
}

export function HandSummaryPanel({ state, onNextHand, canStartNextHand, blockedReason, showNextHand = true }: HandSummaryPanelProps) {
  const [tab, setTab] = useState('result');
  const [selected, setSelected] = useState<Record<number, string>>({});
  const summary = state.summary;
  if (!summary) return null;
  const nameOf = (id: string) => state.players.find(p => p.id === id)?.name ?? id;
  const awards = summary.awards ?? summary.payouts;
  const runs = summary.runs ?? [{ board: state.communityCards, revealed: summary.revealed, payouts: awards }];
  return <div className="summary summary-detail">
    <div className="summary-tabs" role="tablist" aria-label="結果の表示">
      <button role="tab" aria-selected={tab === 'result'} onClick={() => setTab('result')}>結果</button>
      <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>手順{state.history?.length ? ` · ${state.history.length}` : ''}</button>
    </div>
    {tab === 'history' ? <HandHistory state={state} /> : <>
      {runs.map((run,index) => {
        const id = selected[index] ?? run.payouts[0]?.playerId ?? run.revealed[0]?.playerId;
        const hand = run.revealed.find(h => h.playerId === id);
        const used = hand?.usedCards ?? (hand ? evaluateHand(hand.holeCards, run.board, state.variant)?.cards ?? [] : []);
        return <section className="summary-run" key={index}>
          {runs.length > 1 && <h3 className="summary-run-label">{index + 1}本目</h3>}
          <div className="summary-run-board">{run.board.map((card,i) => <PlayingCard key={i} card={card} size="sm"
            highlighted={usesCard(used,card)} dimmed={used.length > 0 && !usesCard(used,card)} />)}</div>
          {run.revealed.length > 0 ? <ul className="summary-hands">{run.revealed.map(h => {
            const win = run.payouts.find(p => p.playerId === h.playerId);
            return <li key={h.playerId}><button type="button" className="summary-hand" aria-pressed={id === h.playerId} onClick={() => setSelected(old => ({ ...old, [index]: h.playerId }))}>
              <span className="summary-hand-name">{nameOf(h.playerId)}{win && <b className="summary-hand-win">WIN +{win.amount.toLocaleString()}</b>}</span>
              <span className="summary-hand-cards">{h.holeCards.map((card,i) => <PlayingCard key={i} card={card} size="sm"
                highlighted={id === h.playerId && usesCard(used,card)} dimmed={id === h.playerId && used.length > 0 && !usesCard(used,card)} />)}</span>
              <span className="summary-hand-ranking">{h.rankingName}</span>
            </button></li>;
          })}</ul> : <p className="summary-note">全員が降りたため、手は公開されません。</p>}
        </section>;
      })}
      <ul className="summary-payouts">{summary.payouts.map(p => {
        const award = awards.find(a => a.playerId === p.playerId)?.amount ?? 0;
        const refund = p.amount - award;
        return <li key={p.playerId}>{nameOf(p.playerId)} <span>{award > 0 && <strong>獲得 +{award.toLocaleString()}</strong>}{refund > 0 && <small>返却 +{refund.toLocaleString()}</small>}</span></li>;
      })}</ul>
      {summary.rabbit.length > 0 && <div className="summary-rabbit"><span className="summary-rabbit-label">配られるはずだった札</span>
        <span className="summary-rabbit-cards">{summary.rabbit.map((card,i) => <PlayingCard key={i} card={card} size="sm" />)}</span></div>}
    </>}
    {showNextHand && (canStartNextHand ? <button type="button" className="btn table-command table-command-primary" onClick={onNextHand}>次のハンド</button> : <p className="summary-note">{blockedReason}</p>)}
  </div>;
}
