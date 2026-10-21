// Completed production-engine hand for responsive result presentation checks.
import { createRoot } from 'react-dom/client';
import { createGame, legalActions, project, reduce, STANDARD_VARIANT } from '@wildcard/engine';
import { TableView } from '../../src/components/TableView.js';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/cards.css';
import '../../src/game.css';
const count = Number(new URLSearchParams(location.search).get('seats')) || 10;
const twice = new URLSearchParams(location.search).has('twice');
let state = createGame({ seatCount: count, smallBlind: 10, bigBlind: 20,
  variant: { ...STANDARD_VARIANT, options: { ...STANDARD_VARIANT.options, runItTwice: { max: twice ? 2 : 1 } } } });
for (let seat = 0; seat < count; seat++) state = reduce(state, { type: 'sit', playerId: `p${seat}`, seat, name: seat ? `CPU${seat}` : 'あなた', chips: twice ? 20 : 1000 });
state = reduce(state, { type: 'startHand', seed: 55 });
while (state.phase === 'betting' && state.turnPlayerId) {
  const playerId = state.turnPlayerId;
  state = reduce(state, { type: legalActions(state, playerId)!.canCheck ? 'check' : 'call', playerId });
}
while (state.phase === 'runChoice' && state.turnPlayerId) state = reduce(state, { type: 'runItTwice', playerId: state.turnPlayerId, agree: true });
createRoot(document.getElementById('root')!).render(<TableView
  snapshot={{ state: project(state, 'p0'), viewerId: 'p0', status: 'local', note: null }}
  title="結果表示" subtitle="" onExit={() => {}} onAction={() => {}} controllablePlayerId={null}
  onStartHand={() => {}} onCancelNextHand={() => {}} startRejection={null} banner={null} />);
