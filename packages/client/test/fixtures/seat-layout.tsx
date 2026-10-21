// Vite-only layout fixture: real deals, with a projected fold/exposure for stable geometry checks.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createGame, project, reduce } from '@wildcard/engine';
import { TableView } from '../../src/components/TableView.js';
import '../../src/styles.css';
import '../../src/layout.css';
import '../../src/cards.css';
import '../../src/game.css';

function Harness() {
  const [options, setOptions] = useState({ seats: 10, cards: 2, chips: 1000, folded: false, exposed: false, dealt: true });
  Object.assign(window, { seatFixture: { set: (next: Partial<typeof options>) => setOptions(old => ({ ...old, ...next })) } });
  const base = createGame();
  let game = createGame({ seatCount: options.seats, smallBlind: 10, bigBlind: 20,
    variant: { ...base.variant, structure: { ...base.variant.structure, holeCards: options.cards } } });
  for (let seat = 0; seat < options.seats; seat++)
    game = reduce(game, { type: 'sit', playerId: `p${seat}`, name: seat ? `CPU${seat}` : 'あなた', seat, chips: options.chips });
  if (options.dealt) game = reduce(game, { type: 'startHand', seed: 55 });
  const visible = project(game, 'p0');
  const state = { ...visible, players: visible.players.map(player => ({ ...player, folded: options.folded,
    exposedHoleCards: options.exposed ? [0] : [],
    holeCards: options.exposed ? game.players.find(p => p.id === player.id)!.holeCards.map((card, i) => i === 0 || player.id === 'p0' ? card : null) : player.holeCards,
  })) };
  return <TableView snapshot={{ state, viewerId: 'p0', status: 'local', note: null }} title="席の確認" subtitle=""
    onExit={() => {}} onAction={() => {}} controllablePlayerId={null} onStartHand={() => {}}
    startRejection={null} banner={null} />;
}
createRoot(document.getElementById('root')!).render(<Harness />);
