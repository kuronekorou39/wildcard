import type { VisibleState } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';

interface HandSummaryPanelProps {
  readonly state: VisibleState;
  readonly onNextHand: () => void;
  readonly canStartNextHand: boolean;
  readonly blockedReason: string | null;
}

export function HandSummaryPanel({
  state,
  onNextHand,
  canStartNextHand,
  blockedReason,
}: HandSummaryPanelProps) {
  const summary = state.summary;
  if (!summary) return null;

  const nameOf = (playerId: string) =>
    state.players.find((p) => p.id === playerId)?.name ?? playerId;

  return (
    <div className="summary">
      <div className="summary-title">ハンド終了</div>

      {summary.revealed.length > 0 ? (
        <ul className="summary-hands">
          {summary.revealed.map((hand) => (
            <li key={hand.playerId} className="summary-hand">
              <span className="summary-hand-name">{nameOf(hand.playerId)}</span>
              <span className="summary-hand-cards">
                {hand.holeCards.map((card, i) => (
                  <PlayingCard key={i} card={card} size="sm" />
                ))}
              </span>
              <span className="summary-hand-ranking">{hand.rankingName}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="summary-note">全員が降りたため、手は公開されません。</p>
      )}

      <ul className="summary-payouts">
        {summary.payouts.map((payout) => (
          <li key={payout.playerId}>
            {nameOf(payout.playerId)} <strong>+{payout.amount.toLocaleString()}</strong>
          </li>
        ))}
      </ul>

      {canStartNextHand ? (
        <button type="button" className="btn btn-primary btn-large" onClick={onNextHand}>
          次のハンド
        </button>
      ) : (
        <p className="summary-note">{blockedReason}</p>
      )}
    </div>
  );
}
