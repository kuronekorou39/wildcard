import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const token = () => randomBytes(32).toString('hex');
export const createKey = 'local-test-key';
export async function bundle() {
  await mkdir('dist', { recursive: true });
  await build({ entryPoints: ['src/worker.ts'], outfile: 'dist/test-worker.js', bundle: true,
    format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], target: 'es2022', external: ['cloudflare:workers'] });
  await build({ entryPoints: ['../engine/src/index.ts'], outfile: 'dist/test-engine.mjs', bundle: true, format: 'esm', platform: 'node' });
}
// 入口の回数制限。検証は1つのIPから10人分をまとめて動かすので、本番（wrangler.jsonc）より広い枠にする
export const limits = (create, http, socket) => ({
  CREATE_LIMIT: { namespace_id: '1001', simple: { limit: create, period: 60 } },
  HTTP_LIMIT: { namespace_id: '1002', simple: { limit: http, period: 60 } },
  SOCKET_LIMIT: { namespace_id: '1003', simple: { limit: socket, period: 60 } },
});
const simulationLimits = limits(50, 1200, 400);
export async function runtime(persist, ratelimits = simulationLimits) {
  const directory = persist ?? await mkdtemp(join(tmpdir(), 'wildcard-server-'));
  const mf = new Miniflare({ name: 'wildcard-test', modules: true, scriptPath: resolve('dist/test-worker.js'),
    compatibilityDate: '2026-07-30', log: new Log(LogLevel.ERROR), ratelimits,
    durableObjects: { TABLES: { className: 'PokerTable', useSQLite: true }, DIRECTORY: { className: 'TableDirectory', useSQLite: true } },
    durableObjectsPersist: directory, bindings: { CREATE_KEY: createKey, ALLOWED_ORIGINS: 'http://localhost:5173', MAX_TABLES: '5', TABLE_TTL_HOURS: '168' } });
  const base = (await mf.ready).origin;
  return { mf, base, directory };
}
export async function api(base, room, path = '', options = {}) {
  const response = await fetch(`${base}/api/tables/${room}${path}`, options);
  const value = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${value.error}`);
  return value;
}
export async function createTable(base, variant, count = 10, overrides = {}) {
  const room = randomUUID(); const credentials = Array.from({ length: count }, token);
  await api(base, room, '', { method: 'PUT', headers: { Authorization: `Bearer ${createKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: credentials[0], options: { name: '主催者', chips: 10000,
      smallBlind: 10, bigBlind: 20, seatCount: 10, hostPlays: true, variant, ...overrides } }) });
  for (let i = 1; i < count; i++) await api(base, room, '/join', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: credentials[i], name: `参加者${i}`, play: true }) });
  const peers = await Promise.all(credentials.map(credential => connect(base, room, credential)));
  await peers[0].wait(snapshot => snapshot.online.length === count);
  return { room, credentials, peers };
}
export async function connect(base, room, credential) {
  const socket = new WebSocket(`${base.replace('http', 'ws')}/api/tables/${room}/socket`);
  const peer = { socket, snapshot: null, receivedAt: 0, receipts: new Map(), errors: [], bytes: 0,
    async wait(predicate, timeout = 15000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) { if (peer.snapshot && predicate(peer.snapshot)) return peer.snapshot; await pause(20); }
      throw new Error(`Snapshot timeout; phase=${peer.snapshot?.state.phase}; errors=${peer.errors.join(',')}`);
    },
    make(command) { return { type: 'command', id: randomUUID(), seq: (peer.snapshot.lastReceipt?.seq ?? 0) + 1,
      handId: peer.snapshot.runtime.handId, turnId: peer.snapshot.runtime.clock?.id ?? null, command }; },
    async send(command, request = peer.make(command)) {
      socket.send(JSON.stringify(request));
      const deadline = Date.now() + 15000;
      while (!peer.receipts.has(request.id) && Date.now() < deadline) await pause(20);
      const receipt = peer.receipts.get(request.id);
      if (!receipt) throw new Error('Receipt timeout');
      if (!receipt.ok) throw new Error(receipt.message);
      await peer.wait(snapshot => (snapshot.lastReceipt?.seq ?? 0) >= receipt.seq);
      return request;
    },
  };
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'authenticate', protocol: 1, token: credential })));
  socket.addEventListener('message', event => {
    peer.bytes += Buffer.byteLength(String(event.data));
    if (event.data === 'pong') return;
    const message = JSON.parse(String(event.data));
    if (message.type === 'snapshot') { peer.snapshot = message; peer.receivedAt = Date.now(); }
    if (message.type === 'receipt') peer.receipts.set(message.receipt.id, message.receipt);
    if (message.type === 'error') peer.errors.push(message.message);
  });
  socket.addEventListener('error', () => peer.errors.push('socket error'));
  await peer.wait(() => true);
  return peer;
}
export function readyDelay(peer) { return Math.max(0, peer.receivedAt + peer.snapshot.runtime.readyAt - peer.snapshot.serverNow - Date.now()); }
export async function settle(peer) { await pause(readyDelay(peer) + 80); }
export function close(peers) { for (const peer of peers) if (peer.socket.readyState === WebSocket.OPEN) peer.socket.close(); }
