import type { VisiblePlayer } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';
import { seatPosition } from '../seatLayout.js';

interface SeatProps {
  readonly slot: number;
  readonly seatCount: number;
  /** 空席なら null。 */
  readonly player: VisiblePlayer | null;
  readonly isTurn: boolean;
  readonly isDealer: boolean;
  readonly isViewer: boolean;
}

export function Seat({ slot, seatCount, player, isTurn, isDealer, isViewer }: SeatProps) {
  const { left, top } = seatPosition(slot, seatCount);
  const style = { left: `${left}%`, top: `${top}%` };

  const classes = ['seat'];
  if (!player) classes.push('seat-empty');
  if (isTurn) classes.push('seat-turn');
  if (isViewer) classes.push('seat-viewer');
  if (player?.folded) classes.push('seat-folded');
  if (player?.away) classes.push('seat-away');

  if (!player) {
    return (
      <div className={classes.join(' ')} style={style}>
        <span className="seat-empty-label">空席</span>
      </div>
    );
  }

  return (
    <div className={classes.join(' ')} style={style}>
      {isDealer && <span className="seat-dealer-button" title="ディーラーボタン">D</span>}

      <div className="seat-cards">
        {Array.from({ length: player.holeCardCount }, (_, i) => (
          <PlayingCard key={i} card={player.holeCards[i] ?? null} size="sm" />
        ))}
      </div>

      <div className="seat-name">{player.name}</div>
      <div className="seat-chips">{player.chips.toLocaleString()}</div>

      {player.bet > 0 && <div className="seat-bet">{player.bet.toLocaleString()}</div>}
      {player.allIn && <div className="seat-tag seat-tag-allin">オールイン</div>}
      {player.folded && !player.allIn && <div className="seat-tag">フォールド</div>}
      {player.waiting && <div className="seat-tag">次から参加</div>}
      {player.away && !player.folded && <div className="seat-tag">離席中</div>}
    </div>
  );
}
