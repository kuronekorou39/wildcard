import { type VisibleState, boardSize, boardsOf, streetName } from '@wildcard/engine';
import type { CSSProperties } from 'react';
import { CardSlot, PlayingCard } from './PlayingCard.js';
import { Seat } from './Seat.js';
import { displaySlot } from '../seatLayout.js';
import { Brand } from './Brand.js';
import { TableFelt } from './TableFelt.js';
import { TablePositionMarkers } from './TablePositionMarkers.js';
import type { TableShape } from '../tableAppearance.js';
import type { TableRuntimeSnapshot } from '../transport/tableRuntime.js';
import { PotChips, TableMotion, TableStock } from './TableMotion.js';
import { chipsTotal, contributedChips, TABLE_TIMING as T } from '../transport/presentation.js';
import { usePresentationTime } from '../hooks/usePresentationTime.js';

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
  readonly runtime?: TableRuntimeSnapshot | null;
}

export function PokerTable({ state, viewerId, shape = 'racetrack', runtime = null }: PokerTableProps) {
  const events = runtime?.events ?? [];
  const until = Math.max(runtime?.readyAt ?? 0, ...events.map(event => event.at + T.win + T.card));
  const now = usePresentationTime(until);
  const winEvents = events.filter(event => event.kind === 'win');
  const payoutAt = winEvents.length ? Math.min(...winEvents.map(event => event.at)) : 0;
  const potCleared = state.phase === 'showdown' && now >= payoutAt + T.win;
  const potChips = potCleared ? [] : runtime?.potChips ?? contributedChips(state.pot);
  const pot = state.phase === 'showdown' ? chipsTotal(potChips) : state.pot;
  const revealShowdown = now >= payoutAt - T.showdownPause;
  const pendingBurns = events.reduce((sum, event) => sum +
    (event.kind === 'burn' && now < event.at + T.card ? event.count : 0), 0);
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
    const actual = bySlot.get(slot) ?? null;
    const payout = actual && winEvents.find(event => event.kind === 'win' && event.playerId === actual.id);
    const player = actual && state.phase === 'showdown' ? { ...actual,
      chips: actual.chips - (payout?.kind === 'win' && now < payout.at + T.win ? payout.amount : 0),
      holeCards: actual.holeCards.map((card, index) => revealShowdown || actual.id === viewerId || actual.exposedHoleCards.includes(index) ? card : null),
    } : actual;
    return (
      <Seat
        key={slot}
        slot={slot}
        seatCount={state.seatCount}
        player={player}
        isTurn={player !== null && player.id === state.turnPlayerId}
        isViewer={player !== null && player.id === viewerId}
        clock={runtime?.clock ?? null}
        dealtAt={runtime?.handStartedAt ?? null}
        dealOrder={player ? (player.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount : 0}
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
          {state.phase !== 'waiting' && <TableStock burnedCount={Math.max(0, state.burnedCount - pendingBurns)} />}
          <div className="table-watermark"><Brand compact /></div>
          <div className="table-phase">{state.phase === 'showdown' && !potCleared
            ? now >= payoutAt ? '配当' : revealShowdown ? 'ショーダウン' : 'ランアウト'
            : phaseLabel(state)}</div>

          {/* 2本走ったら、ボードの数だけ並ぶ。1本なら今までどおり1列。 */}
          {boards.map((board, run) => (
            <div key={run} className={`community-cards${boardLength > 5 ? ' community-cards-wide' : ''}`}>
              {boards.length > 1 && <span className="community-run">{run + 1}本目</span>}
              {/* 枠の数はバリアントが決める。フロップ6枚なら場は8枚になる。 */}
              {Array.from({ length: boardLength }, (_, i) => {
                const card = board[i];
                const reveal = runtime?.events.slice().reverse().find(event => event.kind === 'board' && event.run === run && i >= event.from && i < event.from + event.count);
                return card && (!reveal || now >= reveal.at) ? <PlayingCard key={i} card={card} revealAt={reveal?.at ?? null} revealKind="board"
                  revealDelay={(reveal?.kind === 'board' ? i - reveal.from : 0) * T.boardGap} /> : <CardSlot key={i} />;
              })}
            </div>
          ))}

          <div className="table-pot"><PotChips stacks={potChips} /><span>ポット {pot.toLocaleString()}</span></div>
        </div>

        {Array.from({ length: state.seatCount }, (_, slot) =>
          viewer && slot === 0 ? null : renderSeat(slot),
        )}
        <TablePositionMarkers state={state} viewerSeat={viewerSeat} />
      </div>
      {viewer && <div className="table-player">{renderSeat(0)}</div>}
      <TableMotion state={state} runtime={runtime} />
    </div>
  );
}
