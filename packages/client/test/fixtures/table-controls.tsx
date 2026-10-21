// Vite-only browser fixture. Not an entry point in the production build.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createGame, legalActions, project, reduce, type Action } from '@wildcard/engine';
import { TableView } from '../../src/components/TableView.js';
import type { ConnectionStatus, TableSnapshot } from '../../src/transport/types.js';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/cards.css';
import '../../src/game.css';

function deal(seed = 11) {
  let game = createGame({ seatCount: 6, smallBlind: 10, bigBlind: 20 });
  for (let seat = 0; seat < 6; seat++)
    game = reduce(game, { type: 'sit', playerId: `p${seat}`, name: `Player ${seat}`, seat, chips: 1000 });
  return reduce(game, { type: 'startHand', seed });
}
let game = deal();
let viewerId: string | null = 'p0';
let status: ConnectionStatus = 'local';
const sent: Action[] = [];
const snapshot = (): TableSnapshot => ({ state: project(game, viewerId), viewerId, status, note: null });

function Harness() {
  const [current, setCurrent] = useState(snapshot);
  const emit = () => setCurrent(snapshot());
  const api = {
    reset: () => { game = deal(); viewerId = 'p0'; status = 'local'; sent.length = 0; emit(); },
    advance: () => {
      const playerId = game.turnPlayerId!;
      const legal = legalActions(game, playerId)!;
      game = reduce(game, { type: legal.canCheck ? 'check' : 'call', playerId });
      emit();
    },
    finish: () => {
      while (game.phase === 'betting' && game.turnPlayerId)
        game = reduce(game, { type: 'fold', playerId: game.turnPlayerId });
      emit();
    },
    next: () => { game = reduce(game, { type: 'startHand', seed: 22 }); emit(); },
    replaceHand: () => { game = deal(33); emit(); },
    connection: (value: ConnectionStatus) => { status = value; emit(); },
    view: (value: string | null) => { viewerId = value; emit(); },
    refresh: emit,
    sent: () => [...sent],
    acknowledge: () => { for (const action of sent) game = reduce(game, action); emit(); },
  };
  Object.assign(window, { tableFixture: api });
  return <TableView snapshot={current} title="操作確認" subtitle="" onExit={() => {}}
    // Deliberately leave the old snapshot until acknowledge(), like a slow network.
    onAction={action => { sent.push(action); }}
    controllablePlayerId={current.state.turnPlayerId === current.viewerId ? current.viewerId : null}
    onStartHand={api.next} startRejection={null} banner={null} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
