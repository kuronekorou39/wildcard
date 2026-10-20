import { type VisibleState, boardSize, boardsOf, streetName } from '@wildcard/engine';
import type { CSSProperties } from 'react';
import { CardSlot, PlayingCard } from './PlayingCard.js';
import { Seat } from './Seat.js';
import { displaySlot } from '../seatLayout.js';
import { Brand } from './Brand.js';
import { TableFelt } from './TableFelt.js';
import { TablePositionMarkers } from './TablePositionMarkers.js';
import type { TableShape } from '../tableAppearance.js';

/**
 * 今どの段階かの表示。
 *
 * 「フロップ」「ターン」といった名前はバリアントが持っているので、
 * ここでは streetName に聞くだけ。フロップ6枚でも独自の段取りでも同じ。
 */
function phaseLabel(state: VisibleState): string {
  if (state.phase === 'waiting') return '開始待ち';
  if (state.phase === 'runChoice') return '何本走る?';
  if (state.phase === 'showdown') return 'ショーダウン';
  return streetName(state.variant, state.streetIndex);
}

interface PokerTableProps {
  readonly state: VisibleState;
  readonly viewerId: string | null;
  readonly shape?: TableShape;
}

export function PokerTable({ state, viewerId, shape = 'racetrack' }: PokerTableProps) {
  const viewer = state.players.find((p) => p.id === viewerId);
  // 自分を必ず手前（スロット0）に置く。観戦者は席番号そのままで並べる。
  const viewerSeat = viewer?.seat ?? null;

  const bySlot = new Map<number, VisibleState['players'][number]>();
  for (const player of state.players) {
    bySlot.set(displaySlot(player.seat, viewerSeat, state.seatCount), player);
  }

  const boards = boardsOf(state);
  const boardLength = boardSize(state.variant.structure);
  const boardRows = boards.length * (boardLength > 5 ? Math.ceil(boardLength / 4) : 1);
  const renderSeat = (slot: number) => {
    const player = bySlot.get(slot) ?? null;
    return (
      <Seat
        key={slot}
        slot={slot}
        seatCount={state.seatCount}
        player={player}
        isTurn={player !== null && player.id === state.turnPlayerId}
        isViewer={player !== null && player.id === viewerId}
      />
    );
  };

  return (
    <div className="table-area" data-seats={state.seatCount} data-shape={shape} data-boards={boards.length} style={{
      '--board-rows': boardRows,
      '--desktop-board-rows': boards.length * Math.ceil(boardLength / 8),
    } as CSSProperties}>
      <div className="table-surface">
        <TableFelt shape={shape} />

        <div className="table-center">
          <div className="table-watermark"><Brand compact /></div>
          <div className="table-phase">{phaseLabel(state)}</div>

          {/* 2本走ったら、ボードの数だけ並ぶ。1本なら今までどおり1列。 */}
          {boards.map((board, run) => (
            <div key={run} className={`community-cards${boardLength > 5 ? ' community-cards-wide' : ''}`}>
              {run > 0 && <span className="community-run">{run + 1}本目</span>}
              {/* 枠の数はバリアントが決める。フロップ6枚なら場は8枚になる。 */}
              {Array.from({ length: boardLength }, (_, i) => {
                const card = board[i];
                return card ? <PlayingCard key={i} card={card} /> : <CardSlot key={i} />;
              })}
            </div>
          ))}

          <div className="table-pot">ポット {state.pot.toLocaleString()}</div>
        </div>

        {Array.from({ length: state.seatCount }, (_, slot) =>
          viewer && slot === 0 ? null : renderSeat(slot),
        )}
        <TablePositionMarkers state={state} viewerSeat={viewerSeat} />
      </div>
      {viewer && <div className="table-player">{renderSeat(0)}</div>}
    </div>
  );
}
