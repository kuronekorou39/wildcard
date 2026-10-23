import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, project } from '@wildcard/engine';
import { TableRuntime, type ServerSnapshot } from '@wildcard/table';
import { loadConnection, normalizeServerUrl, saveConnection, tableIdFrom } from '../src/serverConnection.js';
import { ServerTransport } from '../src/transport/server.js';

class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) { Socket.all.push(this); }
  send(value: string) { this.sent.push(value); }
  close(code = 1000, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const settings = { serverUrl: 'https://table.example', tableId: 'f8ec3865-4e36-4ff2-923a-17bb9b714aa1', name: '参加者', token: 'a'.repeat(64) };
const state = (): ServerSnapshot => ({ type: 'snapshot', protocol: 1, revision: 1, serverNow: Date.now(),
  state: project(createGame(), 'p1'), runtime: new TableRuntime(() => {}, 30000, false, { manual: true }).snapshot(),
  viewerId: 'p1', owner: true, closed: false, expiresAt: Date.now() + 3600000, online: ['p1'], lastReceipt: null, startRejection: null });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000); Socket.all = [];
  const data = new Map<string, string>();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  saveConnection(settings);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function start() {
  const transport = new ServerTransport(settings); transport.start(); vi.advanceTimersByTime(0);
  const socket = Socket.all.at(-1)!; socket.open(); socket.message(state());
  return { transport, socket };
}
describe('サーバーへの接続', () => {
  it('資格情報をURLに入れず、送信前に操作を保存する', () => {
    const { transport, socket } = start();
    expect(socket.url).not.toContain(settings.token);
    expect(JSON.parse(socket.sent[0]!).type).toBe('authenticate');
    transport.send({ type: 'start' }); transport.send({ type: 'start' });
    expect(socket.sent).toHaveLength(2);
    const request = JSON.parse(socket.sent[1]!);
    expect(loadConnection(settings.serverUrl, settings.tableId)?.pending).toEqual(request);
    expect(transport.snapshot().pending).toBe(true);
    transport.stop();
  });
  it('応答前の切断では同じ操作だけを再送し、確定済みなら再送しない', () => {
    const { transport, socket } = start();
    transport.send({ type: 'start' });
    const request = JSON.parse(socket.sent[1]!);
    socket.close(1006); vi.advanceTimersByTime(500);
    const next = Socket.all.at(-1)!; next.open(); next.message(state());
    expect(JSON.parse(next.sent[1]!)).toEqual(request);
    next.message({ ...state(), revision: 2, lastReceipt: { id: request.id, seq: request.seq, ok: true, message: null } });
    expect(loadConnection(settings.serverUrl, settings.tableId)?.pending).toBeNull();
    expect(transport.snapshot().pending).toBe(false);
    next.close(1006); vi.advanceTimersByTime(500);
    const third = Socket.all.at(-1)!; third.open(); third.message({ ...state(), revision: 2, lastReceipt: { id: request.id, seq: request.seq, ok: true, message: null } });
    expect(third.sent).toHaveLength(1);
    transport.stop();
  });
  it('拒否された操作で操作部を固定せず、理由を表示して次の操作を受け付ける', () => {
    const { transport, socket } = start();
    transport.send({ type: 'start' });
    const request = JSON.parse(socket.sent[1]!);
    const receipt = { id: request.id, seq: request.seq, ok: false, message: '参加者が2人未満' };
    socket.message({ type: 'receipt', receipt });
    socket.message({ ...state(), revision: 2, lastReceipt: receipt });
    expect(transport.snapshot().note).toBe(receipt.message);
    expect(transport.snapshot().pending).toBe(false);
    transport.send({ type: 'start' });
    expect(JSON.parse(socket.sent.at(-1)!).seq).toBe(2);
    transport.stop();
  });
  it('StrictMode の直後の停止は接続を残さず、別タブに移った席を奪い返さない', () => {
    const transport = new ServerTransport(settings);
    transport.start(); transport.stop(); vi.advanceTimersByTime(0);
    expect(Socket.all).toHaveLength(0);
    transport.start(); vi.advanceTimersByTime(0);
    Socket.all[0]!.open(); Socket.all[0]!.close(4001, '別のタブで接続しました');
    vi.advanceTimersByTime(60000);
    expect(Socket.all).toHaveLength(1);
    expect(transport.snapshot().status).toBe('rejected');
    transport.stop();
  });
  it('再接続先は明示したHTTPSまたはローカルURLに限り、招待から接続先を変更しない', () => {
    expect(normalizeServerUrl('https://example.com/')).toBe('https://example.com');
    expect(() => normalizeServerUrl('http://example.com')).toThrow();
    expect(() => normalizeServerUrl('https://secret@example.com')).toThrow();
    expect(tableIdFrom(`https://other.example/#table=${settings.tableId}&server=https://untrusted.example`)).toBe(settings.tableId);
  });
});
