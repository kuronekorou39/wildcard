import { type VisibleState, boardSize, boardsOf, streetName } from '@wildcard/engine';
import { useMemo, useState, type CSSProperties } from 'react';
import { showdownSelections } from '../showdownSelection.js';
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
import { ShowdownResult, showdownWinners } from './ShowdownResult.js';
import { presentedChips } from '../chipPresentation.js';
import { TableBets } from './TableBets.js';

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
  readonly revealRunout?: boolean;
}

export function PokerTable({ state, viewerId, shape = 'racetrack', runtime = null, revealRunout = true }: PokerTableProps) {
  const [selection, setSelection] = useState({ summary: state.summary, index: 0 });
  const selectedIndex = selection.summary === state.summary ? selection.index : 0;
  const selections = useMemo(() => showdownSelections(state), [state.summary, state.variant, state.communityCards, state.players]);
  const events = runtime?.events ?? [];
  const until = Math.max(runtime?.readyAt ?? 0, ...events.map(event => event.at + T.win + T.card));
  const now = usePresentationTime(until);
  const winEvents = events.filter(event => event.kind === 'win');
  const payoutAt = winEvents.length ? Math.min(...winEvents.map(event => event.at)) : 0;
  const potCleared = state.phase === 'showdown' && now >= payoutAt + T.win;
  const winners = state.phase === 'showdown' && now >= payoutAt ? showdownWinners(state) : [];
  const selected = now >= payoutAt ? selections[selectedIndex % selections.length] : undefined;
  const result = <ShowdownResult state={state} selectedIndex={selectedIndex} onSelect={index => setSelection({ summary: state.summary, index })} />;
  const fallbackBets = state.players.map(player => ({ playerId: player.id, chips: contributedChips(player.bet) }));
  const fallbackPending = state.players.reduce((sum, player) => sum + player.bet, 0);
  const chips = runtime ? presentedChips(runtime, now) : {
    bets: fallbackBets, pot: contributedChips(Math.max(0, state.pot - fallbackPending)), pending: fallbackPending,
  };
  const potChips = potCleared ? [] : chips.pot;
  const pot = chipsTotal(potChips);
  const showdownReady = now >= (runtime?.showdownAt ?? payoutAt - T.showdownPause);
  const revealShowdown = showdownReady ||
    (revealRunout && runtime?.runoutAt != null && now >= runtime.runoutAt);
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
  const resultInHandArea = potCleared && boards.length > 1 && viewer !== undefined;
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
        winner={winners.find(winner => winner.playerId === player?.id) ?? null}
        usedCards={selected && selected.playerId === player?.id && selected.usedCards.length ? selected.usedCards : undefined}
        usedPositions={selected && selected.playerId === player?.id && selected.usedCards.length ? selected.positions.hole : undefined}
        clock={runtime?.clock ?? null}
        dealtAt={runtime?.handStartedAt ?? null}
        dealOrder={player ? (player.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount : 0}
      />
    );
  };

  return (
    <div className="table-area" data-seats={state.seatCount} data-shape={shape} data-boards={boards.length} data-settled={potCleared} data-result-rail={resultInHandArea} style={{
      '--board-rows': boardRows,
      '--desktop-board-rows': boards.length * Math.ceil(boardLength / 8),
    } as CSSProperties}>
      <div className="table-surface">
        <TableFelt shape={shape} />

        <div className="table-center">
          {state.phase !== 'waiting' && !potCleared && <TableStock burnedCount={Math.max(0, state.burnedCount - pendingBurns)} />}
          {!potCleared && <div className="table-watermark"><Brand compact /></div>}
          {!potCleared && <div className="table-phase">{state.phase === 'showdown'
            ? now >= payoutAt ? '配当' : !showdownReady && runtime?.runoutAt != null ? 'ランアウト' : 'ショーダウン'
            : phaseLabel(state)}</div>}

          {/* 2本走ったら、ボードの数だけ並ぶ。1本なら今までどおり1列。 */}
          {boards.map((board, run) => (
            <div key={run} className={`community-cards${boardLength > 5 ? ' community-cards-wide' : ''}`}>
              {boards.length > 1 && <span className="community-run">{run + 1}本目</span>}
              {/* 枠の数はバリアントが決める。フロップ6枚なら場は8枚になる。 */}
              {Array.from({ length: boardLength }, (_, i) => {
                const card = board[i];
                const reveal = runtime?.events.slice().reverse().find(event => event.kind === 'board' && event.run === run && i >= event.from && i < event.from + event.count);
                return card && (!reveal || now >= reveal.at) ? <PlayingCard key={i} card={card} revealAt={reveal?.at ?? null} revealKind="board"
                  highlighted={selected?.run === run && selected.positions.board[i] === true}
                  dimmed={selected?.run === run && selected.usedCards.length > 0 && selected.positions.board[i] !== true}
                  revealDelay={(reveal?.kind === 'board' ? i - reveal.from : 0) * T.boardGap} /> : <CardSlot key={i} />;
              })}
            </div>
          ))}

          {potCleared ? !resultInHandArea && result
            : <div className="table-pot" data-collected={pot} data-pending={chips.pending}
                aria-label={`回収済み ${pot.toLocaleString()}、未回収 ${chips.pending.toLocaleString()}`}>
                <PotChips stacks={potChips} /><span className="pot-value">{pot.toLocaleString()}</span>
                {chips.pending > 0 && <span className="pot-pending">（+{chips.pending.toLocaleString()}）</span>}
              </div>}
        </div>

        {Array.from({ length: state.seatCount }, (_, slot) =>
          viewer && slot === 0 ? null : renderSeat(slot),
        )}
        <TablePositionMarkers state={state} viewerSeat={viewerSeat} />
        {!potCleared && <TableBets state={state} viewerSeat={viewerSeat} bets={chips.bets} />}
      </div>
      {viewer && <div className="table-player">{renderSeat(0)}
        {resultInHandArea && result}
      </div>}
      <TableMotion state={state} runtime={runtime} />
    </div>
  );
}
