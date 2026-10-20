import { blindPositions, type VisibleState } from '@wildcard/engine';
import type { CSSProperties } from 'react';
import { displaySlot, portraitSeatPosition, seatCoordinates, seatPosition, seatSide } from '../seatLayout.js';

/** inHand は降りた後も維持される。残った人数からブラインドを計算し直さない。 */
export function tablePositions(state: VisibleState) {
  if (state.phase === 'waiting') return null;
  return blindPositions(state.players.filter(p => p.inHand).map(p => p.seat), state.dealerSeat, state.seatCount);
}

export function TablePositionMarkers({ state, viewerSeat }: {
  readonly state: VisibleState;
  readonly viewerSeat: number | null;
}) {
  const blinds = tablePositions(state);
  if (!blinds) return null;
  return <>
    {state.players.filter(player => player.inHand).map(player => {
      const labels = [
        ...(player.seat === state.dealerSeat ? [{ code: 'D', name: 'ディーラー' }] : []),
        ...(player.seat === blinds.smallBlindSeat ? [{ code: 'SB', name: 'スモールブラインド' }] : []),
        ...(player.seat === blinds.bigBlindSeat ? [{ code: 'BB', name: 'ビッグブラインド' }] : []),
      ];
      if (!labels.length) return null;
      const slot = displaySlot(player.seat, viewerSeat, state.seatCount);
      return (
        <div key={player.id} className="table-seat-markers" style={seatCoordinates(slot, state.seatCount) as CSSProperties}
          data-slot={slot} data-viewer={player.seat === viewerSeat}
          data-portrait-side={seatSide(portraitSeatPosition(slot, state.seatCount))}
          data-landscape-side={seatSide(seatPosition(slot, state.seatCount))}>
          <div className="position-chips">
            {labels.map(label => (
              <span key={label.code} className={`table-position-chip position-${label.code.toLowerCase()}`}
                title={`${label.name}：${player.name}`} aria-label={`${label.name}：${player.name}`}>{label.code}</span>
            ))}
          </div>
        </div>
      );
    })}
  </>;
}
