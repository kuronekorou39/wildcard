import type { CSSProperties } from 'react';
import type { VisibleState } from '@wildcard/engine';
import { displaySlot, portraitSeatPosition, seatCoordinates, seatPosition, seatSide } from '../seatLayout.js';
import { chipsTotal, type PostedBet } from '../transport/presentation.js';
import { PotChips } from './TableMotion.js';

/** Each anchor remains mounted so a bet can land there before its stack appears. */
export function TableBets({ state, viewerSeat, bets }: { readonly state: VisibleState; readonly viewerSeat: number | null; readonly bets: readonly PostedBet[] }) {
  return <>{state.players.filter(player => player.inHand).map(player => {
    const slot = displaySlot(player.seat, viewerSeat, state.seatCount);
    const chips = bets.find(bet => bet.playerId === player.id)?.chips ?? [];
    const amount = chipsTotal(chips);
    return <div key={player.id} className="table-bet-anchor" data-player-id={player.id} data-viewer={player.seat === viewerSeat}
      data-portrait-side={seatSide(portraitSeatPosition(slot, state.seatCount))}
      data-landscape-side={seatSide(seatPosition(slot, state.seatCount))}
      style={seatCoordinates(slot, state.seatCount) as CSSProperties}>
      <div className="table-bet" data-amount={amount} aria-label={amount ? `${player.name}のベット ${amount.toLocaleString()}` : undefined}>
        {amount > 0 && <><PotChips stacks={chips} className="posted-chips" />
          <span className="bet-amount" title={amount.toLocaleString()} style={{ '--digits': Math.max(3, amount.toLocaleString().length) } as CSSProperties}>{amount.toLocaleString()}</span></>}
      </div>
    </div>;
  })}</>;
}
