import type { VisiblePlayer } from '@wildcard/engine';
import type { CSSProperties } from 'react';
import { PlayingCard } from './PlayingCard.js';
import { seatCoordinates } from '../seatLayout.js';
import type { TurnClock } from '../transport/tableRuntime.js';
import { TurnRing } from './TurnTimer.js';
import { TABLE_TIMING as T } from '../transport/presentation.js';

interface SeatProps {
  readonly slot: number;
  readonly seatCount: number;
  /** 空席なら null。 */
  readonly player: VisiblePlayer | null;
  readonly isTurn: boolean;
  readonly isViewer: boolean;
  readonly clock?: TurnClock | null;
  readonly dealtAt?: number | null;
  readonly dealOrder?: number;
}

export function Seat({ slot, seatCount, player, isTurn, isViewer, clock, dealtAt, dealOrder = 0 }: SeatProps) {
  const style = { ...seatCoordinates(slot, seatCount), '--hand-count': Math.max(1, player?.holeCards.length ?? 0) } as CSSProperties;

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
    <div className={classes.join(' ')} style={style} data-slot={slot} data-player-id={player.id}
      aria-label={player.folded ? `${player.name}：フォールド済み` : player.name}>
      <div className="seat-profile">
        {isTurn && clock && <TurnRing clock={clock} />}
        <div className="seat-heading">
          <span className="seat-avatar" role="img" aria-label={`${player.name}のアイコン`} data-tone={player.seat % 4}>
            {player.name.match(/^(?:CPU|プレイヤー)(\d+)$/)?.[1] ?? Array.from(player.name.trim())[0] ?? '•'}
          </span>
          <div className="seat-name" title={player.name}>{player.name}</div>
        </div>
        <div className="seat-chips" title={player.chips.toLocaleString()}
          style={{ '--chip-length': Math.max(8, player.chips.toLocaleString().length) } as CSSProperties}
          aria-label={`持ちチップ ${player.chips.toLocaleString()}`}>{player.chips.toLocaleString()}</div>
      </div>

      <div className="seat-cards">
        {/*
          holeCards は見えない札が null で入っている。配列の長さが実際の枚数なので、
          1枚だけ表（配りミス・本人が見せた）という状態もそのまま描ける。
          自分の手札は読めなければ意味がないので一段大きく出す。
        */}
        {player.holeCards.map((card, i) =>
          !player.folded || player.exposedHoleCards.includes(i)
            ? <div key={i} className="seat-held-card" style={{
                '--fan-position': player.holeCards.length > 1 ? i / (player.holeCards.length - 1) - .5 : 0,
              } as CSSProperties}>
                <PlayingCard card={card} size={isViewer ? 'lg' : 'sm'}
                  revealAt={dealtAt ?? null} revealDelay={T.dealReveal + (i * seatCount + dealOrder) * T.dealGap} />
              </div> : null,
        )}
      </div>

      {player.bet > 0 && <div className="seat-bet" aria-label={`ベット ${player.bet.toLocaleString()}`}>{player.bet.toLocaleString()}</div>}
      {player.allIn && <div className="seat-tag seat-tag-allin">オールイン</div>}
      {player.waiting && <div className="seat-tag">次から参加</div>}
      {player.away && !player.folded && <div className="seat-tag">離席中</div>}
    </div>
  );
}
