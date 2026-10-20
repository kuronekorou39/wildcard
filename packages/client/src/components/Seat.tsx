import type { VisiblePlayer } from '@wildcard/engine';
import type { CSSProperties } from 'react';
import { PlayingCard } from './PlayingCard.js';
import { seatCoordinates } from '../seatLayout.js';

interface SeatProps {
  readonly slot: number;
  readonly seatCount: number;
  /** 空席なら null。 */
  readonly player: VisiblePlayer | null;
  readonly isTurn: boolean;
  readonly isViewer: boolean;
}

export function Seat({ slot, seatCount, player, isTurn, isViewer }: SeatProps) {
  const style = seatCoordinates(slot, seatCount) as CSSProperties;

  const classes = ['seat'];
  if (!player) classes.push('seat-empty');
  if (isTurn) classes.push('seat-turn');
  if (isViewer) classes.push('seat-viewer');
  if (player?.folded) classes.push('seat-folded');
  if (player?.away) classes.push('seat-away');

  if (!player) {
    return (
      <div className={classes.join(' ')} style={style} data-slot={slot}>
        <span className="seat-empty-label">空席</span>
      </div>
    );
  }

  return (
    <div className={classes.join(' ')} style={style} data-slot={slot}>
      <div className="seat-profile">
        <span className="seat-avatar" role="img" aria-label={`${player.name}のアイコン`} data-tone={player.seat % 4}>
          {player.name.match(/^(?:CPU|プレイヤー)(\d+)$/)?.[1] ?? Array.from(player.name.trim())[0] ?? '•'}
        </span>
        <div className="seat-identity">
          <div className="seat-name" title={player.name}>{player.name}</div>
          <div className="seat-chips" aria-label={`持ちチップ ${player.chips.toLocaleString()}`}>{player.chips.toLocaleString()}</div>
        </div>
      </div>

      <div className="seat-cards">
        {/*
          holeCards は見えない札が null で入っている。配列の長さが実際の枚数なので、
          1枚だけ表（配りミス・本人が見せた）という状態もそのまま描ける。
          自分の手札は読めなければ意味がないので一段大きく出す。
        */}
        {player.holeCards.map((card, i) => (
          <PlayingCard key={i} card={card} size={isViewer ? 'lg' : 'sm'} />
        ))}
      </div>

      {player.bet > 0 && <div className="seat-bet" aria-label={`ベット ${player.bet.toLocaleString()}`}>{player.bet.toLocaleString()}</div>}
      {player.allIn && <div className="seat-tag seat-tag-allin">オールイン</div>}
      {player.folded && !player.allIn && <div className="seat-tag">フォールド</div>}
      {player.waiting && <div className="seat-tag">次から参加</div>}
      {player.away && !player.folded && <div className="seat-tag">離席中</div>}
    </div>
  );
}
