import assert from 'node:assert/strict';
import { bundle, runtime, createTable, api, connect, close, settle, pause, token } from './harness.mjs';

await bundle();
const { STANDARD_VARIANT, legalActions } = await import('../dist/test-engine.mjs');
let run = await runtime();
let peers = [];
try {
  const fixture = await createTable(run.base, STANDARD_VARIANT);
  peers = fixture.peers;
  const { room, credentials } = fixture;
  for (const path of ['/create', '/release', '/retention']) {
    const denied = await fetch(`${run.base}/api/tables/${room}${path}`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 404);
  }
  const rejected = await fetch(`${run.base}/api/tables/${room}/metrics`, { headers: { Authorization: `Bearer ${credentials[1]}` } });
  assert.equal(rejected.status, 403);
  await peers[0].send({ type: 'start' });
  await peers[9].wait(snapshot => snapshot.runtime.handId === 1);
  for (const peer of peers) {
    const snapshot = peer.snapshot;
    assert.equal('deck' in snapshot.state, false);
    assert.equal('burned' in snapshot.state, false);
    assert.equal(JSON.stringify(snapshot).includes('tokenHash'), false);
    for (const player of snapshot.state.players) assert.equal(player.holeCards.filter(Boolean).length, player.id === snapshot.viewerId ? 2 : 0);
  }
  const observerToken = token();
  await api(run.base, room, '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: observerToken, name: '観戦者', play: false }) });
  const observer = await connect(run.base, room, observerToken);
  assert.equal(observer.snapshot.state.players.flatMap(player => player.holeCards).filter(Boolean).length, 0);
  await settle(peers[0]);
  const actor = peers.find(peer => peer.snapshot.viewerId === peers[0].snapshot.state.turnPlayerId);
  const request = actor.make({ type: 'call' });
  await actor.send({ type: 'call' }, request);
  const before = actor.snapshot.state.players.map(player => player.chips);
  await actor.send({ type: 'call' }, request);
  assert.deepEqual(actor.snapshot.state.players.map(player => player.chips), before);
  const expectedHand = actor.snapshot.state.players.find(player => player.id === actor.snapshot.viewerId).holeCards;
  const index = peers.indexOf(actor);
  actor.socket.close();
  peers[index] = await connect(run.base, room, credentials[index]);
  assert.deepEqual(peers[index].snapshot.state.players.find(player => player.id === peers[index].snapshot.viewerId).holeCards, expectedHand);
  console.log('PASS: 10 seats, authorization, card privacy, duplicate delivery, reconnect');

  const savedDeadline = peers[index].snapshot.runtime.clock.deadline;
  close([...peers, observer]);
  await pause(150);
  const directory = run.directory;
  await run.mf.dispose();
  run = await runtime(directory);
  peers = await Promise.all(credentials.map(credential => connect(run.base, room, credential)));
  assert.equal(peers[0].snapshot.runtime.handId, 1);
  assert.equal(peers[0].snapshot.runtime.clock.deadline, savedDeadline);
  console.log('PASS: process restart restores cards, contributions and original deadline');
  for (let n = 0; peers[0].snapshot.state.phase !== 'showdown' && n < 60; n++) {
    await settle(peers[0]);
    const snapshot = peers[0].snapshot;
    const current = peers.find(peer => peer.snapshot.viewerId === snapshot.state.turnPlayerId);
    const legal = legalActions(snapshot.state, snapshot.state.turnPlayerId);
    await current.send({ type: legal.canCheck ? 'check' : 'call' });
    await peers[0].wait(value => value.revision >= current.snapshot.revision);
  }
  assert.equal(peers[0].snapshot.state.phase, 'showdown');
  assert.equal(peers[0].snapshot.state.players.reduce((sum, player) => sum + player.chips, 0), 100000);
  await peers[0].send({ type: 'pause' });
  const headers = { Authorization: `Bearer ${credentials[0]}` };
  const list = await api(run.base, room, '/history', { headers });
  assert.equal(list.hands.length, 1);
  const record = await api(run.base, room, '/history/1', { headers });
  assert.equal(record.state.phase, 'showdown');
  assert.ok(record.state.history.some(step => step.kind === 'collect'));
  assert.equal('deck' in record.state, false);
  const metrics = await api(run.base, room, '/metrics', { headers });
  assert.ok(metrics.usage.duplicate >= 1);
  assert.ok(metrics.storageBytes > 0);
  console.log('PASS: complete hand, persisted history, transfer ledger, usage counters');
  await settle(peers[0]);
  await peers[0].send({ type: 'close' });
  console.log('PASS: owner can close the table after settlement');
} finally {
  close(peers);
  await run.mf.dispose();
}
