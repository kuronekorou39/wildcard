import type { VisibleState } from '@wildcard/engine';
import { CardSlot, PlayingCard } from './PlayingCard.js';
import { Seat } from './Seat.js';
import { displaySlot } from '../seatLayout.js';

const PHASE_LABEL: Record<VisibleState['phase'], string> = {
  waiting: '開始待ち',
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
  showdown: 'ショーダウン',
};

interface PokerTableProps {
  readonly state: VisibleState;
  readonly viewerId: string | null;
}

export function PokerTable({ state, viewerId }: PokerTableProps) {
  const viewer = state.players.find((p) => p.id === viewerId);
  // 自分を必ず手前（スロット0）に置く。観戦者は席番号そのままで並べる。
  const viewerSeat = viewer?.seat ?? null;

  const bySlot = new Map<number, VisibleState['players'][number]>();
  for (const player of state.players) {
    bySlot.set(displaySlot(player.seat, viewerSeat, state.seatCount), player);
  }

  const dealerPlayer = state.players.find((p) => p.seat === state.dealerSeat);
  const handInProgress = state.phase !== 'waiting';

  return (
    <div className="table-area">
      <div className="table-felt" />

      <div className="table-center">
        <div className="table-phase">{PHASE_LABEL[state.phase]}</div>

        <div className="community-cards">
          {Array.from({ length: 5 }, (_, i) => {
            const card = state.communityCards[i];
            return card ? <PlayingCard key={i} card={card} /> : <CardSlot key={i} />;
          })}
        </div>

        <div className="table-pot">ポット {state.pot.toLocaleString()}</div>
      </div>

      {Array.from({ length: state.seatCount }, (_, slot) => {
        const player = bySlot.get(slot) ?? null;
        return (
          <Seat
            key={slot}
            slot={slot}
            seatCount={state.seatCount}
            player={player}
            isTurn={player !== null && player.id === state.turnPlayerId}
            isDealer={handInProgress && player !== null && player.id === dealerPlayer?.id}
            isViewer={player !== null && player.id === viewerId}
          />
        );
      })}
    </div>
  );
}
