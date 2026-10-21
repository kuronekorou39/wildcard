// Vite-only fixture with the production transport, pacing and auto-deal timers.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { legalActions, type Action } from '@wildcard/engine';
import { LocalTransport } from '../../src/transport/local.js';
import { TABLE_TIMING } from '../../src/transport/presentation.js';
import { useTable } from '../../src/hooks/useTable.js';
import { TableView } from '../../src/components/TableView.js';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/cards.css';
import '../../src/game.css';

function makeTable(seatCount = 6) {
  return new LocalTransport({ seatCount, smallBlind: 10, bigBlind: 20, paced: true, autoNextHandMs: TABLE_TIMING.nextHand,
    viewer: { kind: 'fixed', playerId: 'p0' },
    setup: Array.from({ length: seatCount }, (_, seat) => ({ type: 'sit', playerId: `p${seat}`, name: seat ? `CPU${seat}` : 'あなた', seat, chips: 1000 })),
  });
}
function Harness() {
  const [transport, setTransport] = useState(() => makeTable());
  const snapshot = useTable(transport);
  useEffect(() => { transport.resume(); return () => transport.dispose(); }, [transport]);
  const api = {
    state: () => transport.snapshot(),
    reset: (count = 6) => { transport.dispose(); setTransport(makeTable(count)); },
    start: () => transport.dispatch({ type: 'startHand', seed: 55 }),
    cancel: () => transport.cancelNextHand(),
    action: (action: Action) => transport.dispatch(action),
    advance: () => {
      const playerId = transport.rawState().turnPlayerId!;
      const legal = legalActions(transport.rawState(), playerId)!;
      transport.dispatch({ type: legal.canCheck ? 'check' : 'call', playerId });
    },
    fold: () => transport.dispatch({ type: 'fold', playerId: transport.rawState().turnPlayerId! }),
  };
  Object.assign(window, { pacingFixture: api });
  return <TableView snapshot={snapshot} title="進行確認" subtitle="" onExit={() => {}}
    onAction={action => transport.dispatch(action)} controllablePlayerId="p0"
    onStartHand={api.start} onCancelNextHand={api.cancel} startRejection={null} banner={null} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);
