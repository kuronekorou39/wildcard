// Vite-only browser fixture. Not an entry point in the production build.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createGame, legalActions, project, reduce, type Action } from '@wildcard/engine';
import { TableView } from '../../src/components/TableView.js';
import type { ConnectionStatus, TableSnapshot } from '../../src/transport/types.js';
import { TableRuntime } from '../../src/transport/tableRuntime.js';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/cards.css';
import '../../src/game.css';

let emitCurrent = () => {};
let runtime = new TableRuntime(playerId => { apply({ type: 'timeout', playerId }); emitCurrent(); });
function deal(seed = 11) {
  let game = createGame({ seatCount: 6, smallBlind: 10, bigBlind: 20 });
  for (let seat = 0; seat < 6; seat++)
    game = reduce(game, { type: 'sit', playerId: `p${seat}`, name: `Player ${seat}`, seat, chips: 1000 });
  const action = { type: 'startHand', seed } as const;
  const next = reduce(game, action);
  runtime.advance(game, next, action);
  return next;
}
let game = deal();
runtime.dispose();
function apply(action: Action) {
  const next = reduce(game, action);
  if (next !== game) runtime.advance(game, next, action);
  game = next;
}
let viewerId: string | null = 'p0';
let status: ConnectionStatus = 'local';
const sent: Action[] = [];
const snapshot = (): TableSnapshot => ({ state: project(game, viewerId), viewerId, status, note: null, runtime: runtime.snapshot() });

function Harness() {
  const [current, setCurrent] = useState(snapshot);
  const emit = () => setCurrent(snapshot());
  emitCurrent = emit;
  const api = {
    reset: () => { game = deal(); viewerId = 'p0'; status = 'local'; sent.length = 0; emit(); },
    timed: (ms: number) => {
      runtime.dispose();
      runtime = new TableRuntime(playerId => { apply({ type: 'timeout', playerId }); emitCurrent(); }, ms);
      game = deal(); viewerId = 'p3'; sent.length = 0; emit();
    },
    state: () => snapshot(),
    advance: () => {
      const playerId = game.turnPlayerId!;
      const legal = legalActions(game, playerId)!;
      apply({ type: legal.canCheck ? 'check' : 'call', playerId });
      emit();
    },
    finish: () => {
      while (game.phase === 'betting' && game.turnPlayerId)
        apply({ type: 'fold', playerId: game.turnPlayerId });
      emit();
    },
    next: () => { apply({ type: 'startHand', seed: 22 }); emit(); },
    replaceHand: () => { game = deal(33); emit(); },
    connection: (value: ConnectionStatus) => { status = value; emit(); },
    view: (value: string | null) => { viewerId = value; emit(); },
    refresh: emit,
    sent: () => [...sent],
    acknowledge: () => { for (const action of sent) apply(action); emit(); },
  };
  Object.assign(window, { tableFixture: api });
  return <TableView snapshot={current} title="操作確認" subtitle="" onExit={() => {}}
    // Deliberately leave the old snapshot until acknowledge(), like a slow network.
    onAction={action => { sent.push(action); }}
    controllablePlayerId={current.state.turnPlayerId === current.viewerId ? current.viewerId : null}
    onStartHand={api.next} startRejection={null} banner={null} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
