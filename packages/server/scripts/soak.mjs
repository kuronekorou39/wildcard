import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { bundle, runtime, createTable, api, close, pause } from './harness.mjs';

const minutes = Number(process.env.WILDCARD_SOAK_MINUTES ?? 60);
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new Error('Duration must be 1–120 minutes');
await bundle();
const { STANDARD_VARIANT, legalActions } = await import('../dist/test-engine.mjs');
const run = await runtime();
const tables = [];
const started = Date.now();
try {
  for (let i = 0; i < 3; i++) tables.push(await createTable(run.base, STANDARD_VARIANT));
  await tables[0].peers[0].send({ type: 'start' });
  await tables[1].peers[0].send({ type: 'start' });
  let logged = -1;
  while (Date.now() - started < minutes * 60000) {
    for (const table of tables.slice(0, 2)) {
      const snapshot = table.peers[0].snapshot;
      if (snapshot.state.turnPlayerId && Date.now() > snapshot.runtime.readyAt + 150) {
        const actor = table.peers.find(peer => peer.snapshot.viewerId === snapshot.state.turnPlayerId);
        const legal = legalActions(snapshot.state, snapshot.state.turnPlayerId);
        if (snapshot.state.phase === 'runChoice') await actor.send({ type: 'runItTwice', agree: false });
        else await actor.send({ type: legal.canCheck ? 'check' : 'call' });
      }
      const state = table.peers[0].snapshot.state;
      assert.equal(state.players.reduce((sum, player) => sum + player.chips + player.committed, 0), 100000);
    }
    const elapsed = Math.floor((Date.now() - started) / 60000);
    if (elapsed !== logged) { logged = elapsed; console.log(`minute ${elapsed}: hands ${tables.map(table => table.peers[0].snapshot.runtime.handId).join('/')}`); }
    await pause(180);
  }
  const measurements = [];
  for (const [index, table] of tables.entries()) {
    await table.peers[0].send({ type: 'pause' });
    const result = await api(run.base, table.room, '/metrics', { headers: { Authorization: `Bearer ${table.credentials[0]}` } });
    measurements.push({ mode: index === 2 ? 'idle' : 'active', ...result });
  }
  const report = { environment: 'local Miniflare; not provider billing', elapsedMs: Date.now() - started,
    seatsPerTable: 10, tables: measurements };
  await mkdir('shots-server', { recursive: true });
  await writeFile('shots-server/soak.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { for (const table of tables) close(table.peers); await run.mf.dispose(); }
