import { createGame, project, type Action } from '@wildcard/engine';
import { playerCommand, receiveRuntime, type CommandRequest, type ServerMessage, type ServerSnapshot, type TableCommand } from '@wildcard/table';
import { loadConnection, saveConnection, serverRequest, ServerRequestError, type ServerSettings } from '../serverConnection.js';
import type { TableSnapshot, Transport } from './types.js';

export class ServerTransport implements Transport {
  private cached: TableSnapshot = { state: project(createGame(), null), viewerId: null, status: 'connecting', note: null };
  private current: ServerSnapshot | null = null;
  private listeners = new Set<(snapshot: TableSnapshot) => void>();
  private socket: WebSocket | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private generation = 0;
  private retries = 0;
  private lastHeard = 0;
  private pending: CommandRequest | null;
  private sentPending: string | null = null;
  private actionNote: string | null = null;
  private failures = 0;
  private unavailable = false;
  constructor(readonly settings: ServerSettings) { this.pending = loadConnection(settings.serverUrl, settings.tableId)?.pending ?? null; }
  snapshot() { return this.cached; }
  serverSnapshot() { return this.current; }
  isUnavailable() { return this.unavailable; }
  subscribe(listener: (snapshot: TableSnapshot) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispatch(action: Action) { const command = playerCommand(action); if (command) this.send(command); }
  send(command: TableCommand) {
    if (!this.current || this.pending || this.cached.status !== 'connected' || this.socket?.readyState !== WebSocket.OPEN) return;
    const request: CommandRequest = { type: 'command', id: crypto.randomUUID(), seq: (this.current.lastReceipt?.seq ?? 0) + 1,
      handId: this.current.runtime.handId, turnId: this.current.runtime.clock?.id ?? null, command };
    try { saveConnection({ ...this.settings, pending: request }); }
    catch (failure) { this.update({ note: (failure as Error).message }); return; }
    this.pending = request;
    this.actionNote = null;
    this.update({ pending: true, note: null });
    this.flush();
  }
  start() { this.active = true; this.reconnect = setTimeout(() => this.connect(), 0); }
  stop() {
    this.active = false; this.generation++;
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close(1000); this.socket = null;
  }
  private connect() {
    if (!this.active || this.unavailable) return;
    const generation = ++this.generation;
    this.sentPending = null;
    this.update({ status: 'connecting', note: this.current ? '再接続しています…' : '接続しています…' });
    const socket = new WebSocket(`${this.settings.serverUrl.replace(/^http/, 'ws')}/api/tables/${this.settings.tableId}/socket`);
    this.socket = socket;
    this.lastHeard = Date.now();
    socket.onopen = () => {
      if (generation !== this.generation) return;
      socket.send(JSON.stringify({ type: 'authenticate', protocol: 1, token: this.settings.token }));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastHeard > 50000) { socket.close(); return; }
        if (socket.readyState === WebSocket.OPEN) socket.send('ping');
      }, 20000);
    };
    socket.onmessage = event => {
      if (generation !== this.generation) return;
      this.lastHeard = Date.now();
      if (event.data === 'pong') return;
      try { this.receive(JSON.parse(String(event.data)) as ServerMessage); }
      catch { socket.close(1002, '応答を読み取れません'); }
    };
    socket.onclose = event => {
      if (generation !== this.generation) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (!this.active) return;
      if ([4001, 4003, 4004, 1008].includes(event.code)) {
        this.unavailable = event.code === 4004;
        this.update({ status: 'rejected', pending: false, note: event.reason || '接続を終了しました' }); return;
      }
      this.update({ status: 'disconnected', note: '接続が切れました。再接続しています…' });
      this.reconnect = setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** Math.min(4, this.retries++)));
      // WebSocket handshakes hide HTTP 404/410. Recheck occasionally after transient outages.
      if (this.retries === 1 || this.retries % 4 === 0) void serverRequest(this.settings).catch(failure => {
        if (!this.active || this.cached.status === 'connected') return;
        if (failure instanceof ServerRequestError && [404, 410].includes(failure.status)) {
          this.unavailable = true;
          this.generation++;
          if (this.reconnect) clearTimeout(this.reconnect);
          if (this.heartbeat) clearInterval(this.heartbeat);
          this.socket?.close(1000);
          this.update({ status: 'rejected', pending: false, note: 'この卓は保存期限が過ぎたか、削除されています。' });
        }
      });
    };
    socket.onerror = () => { /* The close event owns retries. */ };
  }
  private receive(message: ServerMessage) {
    if (message.type === 'error') { this.update({ note: message.message }); return; }
    if (message.type === 'receipt') {
      // The following snapshot is authoritative, including rejected commands.
      if (this.pending?.id === message.receipt.id && !message.receipt.ok) {
        this.actionNote = message.receipt.message;
        this.pending = null; this.failures++;
        try { saveConnection({ ...this.settings, pending: null }); } catch {}
        this.update({ note: this.actionNote, pending: false, actionRevision: (this.current?.lastReceipt?.seq ?? 0) * 1000 + this.failures });
      }
      return;
    }
    if (message.type !== 'snapshot' || message.protocol !== 1 || !message.state?.players || !message.runtime) throw new Error('Invalid snapshot');
    if (this.current && message.revision < this.current.revision) return;
    this.current = message;
    this.retries = 0;
    let note = message.closed ? 'この卓は終了しました。卓の情報から記録を確認できます。' : this.actionNote;
    if (this.pending && (message.lastReceipt?.seq ?? 0) >= this.pending.seq) {
      if (message.lastReceipt?.id === this.pending.id && !message.lastReceipt.ok) note = message.lastReceipt.message;
      this.pending = null;
      try { saveConnection({ ...this.settings, pending: null }); } catch (failure) { note = (failure as Error).message; }
    }
    this.cached = { state: message.state, viewerId: message.viewerId, status: 'connected', note,
      runtime: receiveRuntime(message.runtime, message.serverNow), pending: this.pending !== null,
      actionRevision: (message.lastReceipt?.seq ?? 0) * 1000 + this.failures };
    this.emit();
    this.flush();
  }
  private flush() {
    if (!this.pending || this.socket?.readyState !== WebSocket.OPEN || this.cached.status !== 'connected' || this.sentPending === this.pending.id) return;
    this.sentPending = this.pending.id;
    this.socket.send(JSON.stringify(this.pending));
  }
  private update(patch: Partial<TableSnapshot>) { this.cached = { ...this.cached, ...patch }; this.emit(); }
  private emit() { for (const listener of this.listeners) listener(this.cached); }
}
