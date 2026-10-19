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
              {/* 2本走ったなら、役は走りごとに違う。下の内訳で出す。 */}
              {summary.runs === undefined && (
                <span className="summary-hand-ranking">{hand.rankingName}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="summary-note">全員が降りたため、手は公開されません。</p>
      )}

      {/* 走りごとの勝ち負け。2本以上走ったときだけ。 */}
      {summary.runs?.map((run, i) => (
        <div key={i} className="summary-run">
          <div className="summary-run-head">
            <span className="summary-run-label">{i + 1}本目</span>
            <span className="summary-run-board">
              {run.board.map((card, at) => (
                <PlayingCard key={at} card={card} size="sm" />
              ))}
            </span>
          </div>
          <ul className="summary-run-hands">
            {run.revealed.map((hand) => (
              <li key={hand.playerId}>
                {nameOf(hand.playerId)} <span className="summary-hand-ranking">{hand.rankingName}</span>
                {run.payouts.some((p) => p.playerId === hand.playerId) && (
                  <strong className="summary-run-win">
                    +{run.payouts.find((p) => p.playerId === hand.playerId)!.amount.toLocaleString()}
                  </strong>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {summary.rabbit.length > 0 && (
        <div className="summary-rabbit">
          <span className="summary-rabbit-label">配られるはずだった札</span>
          <span className="summary-rabbit-cards">
            {summary.rabbit.map((card, i) => (
              <PlayingCard key={i} card={card} size="sm" />
            ))}
          </span>
        </div>
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
