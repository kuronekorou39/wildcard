import { DurableObject } from 'cloudflare:workers';
import { project } from '@wildcard/engine';
import { isRecord, parseCommand } from '@wildcard/table';
import { MAX_HISTORY, readName, readOptions, TableSession, type Member, type StoredHand, type StoredTable } from './table.js';

export interface Env {
  TABLES: DurableObjectNamespace<PokerTable>;
  DIRECTORY: DurableObjectNamespace<TableDirectory>;
  CREATE_KEY?: string;
  ALLOWED_ORIGINS: string;
  MAX_TABLES: string;
  TABLE_TTL_HOURS: string;
}
const roomPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenPattern = /^[0-9a-f]{64}$/i;
const encoder = new TextEncoder();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const error = (message: string, status = 400) => json({ error: message }, status);
const bearer = (request: Request) => request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
const keyFor = (handId: number) => `hand:${String(handId).padStart(12, '0')}`;
async function hashToken(token: unknown) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new Error('接続情報が不正です');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function body(request: Request, maxBytes = 262144): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('リクエストが空です');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('リクエストが大きすぎます'); }
    chunks.push(result.value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(buffer)); } catch { throw new Error('JSON の形式が不正です'); }
  if (!isRecord(value)) throw new Error('リクエストの形式が不正です');
  return value;
}
function boundedInteger(value: string, fallback: number, max: number) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= max ? n : fallback;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map(value => value.trim());
    if (origin && !allowed.includes(origin)) return error('この接続元は許可されていません', 403);
    const cors = { 'Access-Control-Allow-Origin': origin ?? allowed[0] ?? '', 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let response: Response;
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') response = json({ ok: true, protocol: 1 });
      else {
        const match = /^\/api\/tables\/([^/]+)(\/.*)?$/.exec(url.pathname);
        if (!match || !roomPattern.test(match[1]!)) return error('卓が見つかりません', 404);
        const id = match[1]!;
        const path = match[2] ?? '';
        if (!path && request.method === 'PUT') {
          if (!env.CREATE_KEY || bearer(request) !== env.CREATE_KEY) response = error('作成キーが違います', 401);
          else {
            const input = await body(request);
            const tokenHash = await hashToken(input.token);
            const options = readOptions(input.options);
            response = await env.DIRECTORY.getByName('preview').fetch('https://internal/create', {
              method: 'POST', body: JSON.stringify({ id, tokenHash, options }),
            });
          }
        } else if (['', '/join', '/socket', '/history', '/metrics'].includes(path) || /^\/history\/\d+$/.test(path)) {
          response = await env.TABLES.getByName(id).fetch(new Request(`https://internal${path || '/'}`, request));
        } else response = error('見つかりません', 404);
      }
    } catch (failure) {
      response = error(failure instanceof Error ? failure.message : 'リクエストを処理できませんでした');
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;

/** Creation is limited separately from joining a known invite. No public provisioning endpoint. */
export class TableDirectory extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  override fetch(request: Request): Promise<Response> {
    const job = this.queue.then(() => this.handle(request));
    this.queue = job.catch(() => {});
    return job;
  }
  private async handle(request: Request): Promise<Response> {
    const input = await body(request);
    const id = String(input.id);
    if (!roomPattern.test(id)) return error('卓IDが不正です');
    if (new URL(request.url).pathname === '/release') {
      await this.ctx.storage.delete(id);
      return json({ ok: true });
    }
    const now = Date.now();
    const slots = await this.ctx.storage.list<{ tokenHash: string; expiresAt: number }>();
    for (const [key, slot] of slots) if (slot.expiresAt <= now) {
      // A final hand may outlive the table's admission deadline. Keep its capacity reserved.
      const status = await this.env.TABLES.getByName(key).fetch('https://internal/retention');
      if (!status.ok) return error('卓の保存状態を確認できません', 503);
      const { keepUntil } = await status.json<{ keepUntil: number }>();
      if (keepUntil > now) { slot.expiresAt = keepUntil; await this.ctx.storage.put(key, slot); }
      else { await this.ctx.storage.delete(key); slots.delete(key); }
    }
    const old = slots.get(id);
    if (old && old.tokenHash !== input.tokenHash) return error('別の卓とIDが重複しています', 409);
    if (!old && slots.size >= boundedInteger(this.env.MAX_TABLES, 5, 100)) return error('検証用の卓数が上限に達しました。使わない卓を終了してください', 429);
    const ttlMs = boundedInteger(this.env.TABLE_TTL_HOURS, 168, 720) * 3_600_000;
    await this.ctx.storage.put(id, { tokenHash: input.tokenHash, expiresAt: now + ttlMs });
    const response = await this.env.TABLES.getByName(id).fetch('https://internal/create', {
      method: 'POST', body: JSON.stringify({ ...input, ttlMs }),
    });
    if (!response.ok && !old) await this.ctx.storage.delete(id);
    return response;
  }
}

interface Attachment { memberId: string | null; authBy: number; windowAt: number; count: number }

export class PokerTable extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private sockets() { return this.ctx.getWebSockets().filter(socket => socket.readyState === WebSocket.OPEN); }
  private online(session: TableSession) {
    const ids = new Set(this.sockets().map(socket => (socket.deserializeAttachment() as Attachment).memberId));
    return session.data.members.filter(member => ids.has(member.id) && member.playerId).map(member => member.playerId!);
  }
  private async load(): Promise<TableSession | null> {
    const data = await this.ctx.storage.get<StoredTable>('table');
    if (!data) return null;
    if (data.schema !== 1) throw new Error('卓の保存形式に対応していません');
    return new TableSession(data, Date.now());
  }

  override fetch(request: Request): Promise<Response> {
    // Read-only internal probe bypasses the work queue: the directory may be awaiting this
    // while a table's queued close is releasing its slot in the same directory.
    if (new URL(request.url).pathname === '/retention') return this.retention();
    return this.serial(() => this.handle(request));
  }
  private async retention(): Promise<Response> {
    const session = await this.load();
    const data = session?.data;
    return json({ keepUntil: !data || data.closed ? 0 : Math.max(data.expiresAt, data.cleanupAt ?? 0,
      ['betting', 'runChoice'].includes(data.game.phase) ? Date.now() + 3_600_000 : 0) });
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const started = Date.now();
    if (path === '/create' && request.method === 'POST') {
      const input = await body(request);
      const existing = await this.load();
      if (existing) return existing.member(String(input.tokenHash))?.owner ? json({ id: existing.data.id }) : error('卓は作成済みです', 409);
      const session = TableSession.create(String(input.id), readOptions(input.options), String(input.tokenHash), Date.now(), Number(input.ttlMs));
      await this.commit(session, started);
      return json({ id: session.data.id }, 201);
    }
    const session = await this.load();
    if (!session) return error('卓が見つかりません', 404);
    if (session.data.expiresAt <= Date.now() && !session.data.cleanupAt && !['betting', 'runChoice'].includes(session.data.game.phase)) return error('この検証卓の保存期間が終了しました', 410);
    session.tick(this.online(session));
    if (path === '/socket' && request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (this.sockets().length >= 24) return error('接続数が上限に達しました', 429);
      const pair = new WebSocketPair();
      const client = pair[0]; const socket = pair[1];
      this.ctx.acceptWebSocket(socket);
      socket.serializeAttachment({ memberId: null, authBy: Date.now() + 10_000, windowAt: Date.now(), count: 0 } satisfies Attachment);
      session.data.usage.connections++;
      await this.commit(session, started);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (path === '/join' && request.method === 'POST') {
      const input = await body(request, 4096);
      if (typeof input.play !== 'boolean') return error('参加方法が不正です');
      const tokenHash = await hashToken(input.token);
      const member = session.join(tokenHash, readName(input.name), input.play);
      await this.commitAndBroadcast(session, started);
      return json({ memberId: member.id });
    }
    let member: Member | undefined;
    try { member = session.member(await hashToken(bearer(request))); } catch { /* Uniform authentication error. */ }
    if (!member) return error('参加情報を確認できません', 401);
    if (request.method !== 'GET') return error('対応していない操作です', 405);
    await this.commitAndBroadcast(session, started);
    if (path === '/history') {
      const records = await this.ctx.storage.list<StoredHand>({ prefix: 'hand:', reverse: true, limit: MAX_HISTORY });
      return json({ hands: [...records.values()].map(record => ({ handId: record.handId, endedAt: record.endedAt,
        winners: (record.game.summary?.awards ?? record.game.summary?.payouts ?? []).map(payout => ({
          name: record.game.players.find(player => player.id === payout.playerId)?.name ?? '', amount: payout.amount,
        })) })) });
    }
    const handMatch = /^\/history\/(\d+)$/.exec(path);
    if (handMatch) {
      const record = await this.ctx.storage.get<StoredHand>(keyFor(Number(handMatch[1])));
      return record ? json({ handId: record.handId, endedAt: record.endedAt, state: project(record.game, member.playerId) }) : error('記録が見つかりません', 404);
    }
    if (path === '/metrics') {
      if (!member.owner) return error('主催者のみ確認できます', 403);
      return json({ tableId: session.data.id, createdAt: session.data.createdAt, measuredAt: Date.now(),
        usage: session.data.usage, storedStateBytes: encoder.encode(JSON.stringify(session.data)).byteLength,
        storageBytes: this.ctx.storage.sql.databaseSize, historyLimit: MAX_HISTORY });
    }
    return path === '/' ? json(session.snapshot(member, this.online(session))) : error('見つかりません', 404);
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.serial(async () => {
      const started = Date.now();
      const attachment = socket.deserializeAttachment() as Attachment;
      if (!attachment || typeof message !== 'string' || encoder.encode(message).byteLength > 4096) { socket.close(1008, '不正なメッセージ'); return; }
      const now = Date.now();
      if (now - attachment.windowAt >= 1000) { attachment.windowAt = now; attachment.count = 0; }
      if (++attachment.count > 8) { socket.close(1008, '操作が多すぎます'); return; }
      socket.serializeAttachment(attachment);
      const session = await this.load();
      if (!session) { socket.close(4004, '卓が見つかりません'); return; }
      session.data.usage.messagesIn++;
      session.data.usage.bytesIn += encoder.encode(message).byteLength;
      let input: unknown;
      try { input = JSON.parse(message); } catch { socket.close(1008, '形式が不正です'); return; }
      if (!attachment.memberId) {
        let member: Member | undefined;
        try { member = isRecord(input) && input.type === 'authenticate' && input.protocol === 1 && now <= attachment.authBy
          ? session.member(await hashToken(input.token)) : undefined; } catch { /* No token echo. */ }
        if (!member) { socket.close(4003, '参加情報を確認できません'); return; }
        for (const previous of this.sockets()) {
          if (previous !== socket && (previous.deserializeAttachment() as Attachment).memberId === member.id) previous.close(4001, '別のタブで接続しました');
        }
        attachment.memberId = member.id;
        socket.serializeAttachment(attachment);
        session.connected(member);
        session.tick(this.online(session));
      } else {
        const member = session.data.members.find(value => value.id === attachment.memberId);
        if (!member) { socket.close(4003, '参加情報を確認できません'); return; }
        const command = parseCommand(input);
        if (!command) { socket.send(JSON.stringify({ type: 'error', message: '操作の形式が不正です' })); return; }
        session.tick(this.online(session));
        const receipt = session.command(member, command, this.online(session));
        await this.commitAndBroadcast(session, started, [{ socket, payload: JSON.stringify({ type: 'receipt', receipt }) }]);
        if (session.data.closed) await this.release(session.data.id);
        return;
      }
      await this.commitAndBroadcast(session, started);
    }).catch(() => { try { socket.close(1011, '保存・処理に失敗しました。再接続します'); } catch {} });
  }

  override webSocketClose(socket: WebSocket): Promise<void> {
    return this.serial(async () => {
      try { socket.close(1000, '切断'); } catch {}
      const session = await this.load();
      if (!session) return;
      session.tick(this.online(session));
      await this.commitAndBroadcast(session, Date.now());
    });
  }
  override webSocketError(socket: WebSocket): Promise<void> { return this.webSocketClose(socket); }

  override alarm(): Promise<void> {
    return this.serial(async () => {
      const started = Date.now();
      for (const socket of this.sockets()) {
        const attachment = socket.deserializeAttachment() as Attachment;
        if (!attachment.memberId && attachment.authBy <= Date.now()) socket.close(4003, '認証の期限が切れました');
      }
      const session = await this.load();
      if (!session) return;
      session.data.usage.alarms++;
      session.tick(this.online(session));
      if (session.data.expiresAt <= Date.now()) {
        // Finish an in-progress hand before retiring the temporary table.
        if (['betting', 'runChoice'].includes(session.data.game.phase)) {
          // Preserve the original expiry so no new hand or member can extend the table.
          session.data.cleanupAt = Math.max(session.data.cleanupAt ?? 0, Date.now() + 3_600_000);
        } else if (!session.data.cleanupAt || session.data.cleanupAt <= Date.now()) {
          for (const socket of this.sockets()) socket.close(4004, '保存期間が終了しました');
          await this.ctx.storage.deleteAll();
          await this.ctx.storage.deleteAlarm();
          await this.release(session.data.id);
          return;
        }
      }
      await this.commitAndBroadcast(session, started);
    });
  }

  private async commit(session: TableSession, started: number) {
    session.data.usage.stateWrites++;
    session.data.usage.historyWrites += session.archives.size;
    session.data.usage.handlerMs += Math.max(0, Date.now() - started);
    const deadlines = [session.data.cleanupAt ?? session.data.expiresAt, session.data.runtime.clock?.deadline, session.data.runtime.nextHandAt,
      ...this.sockets().map(socket => { const a = socket.deserializeAttachment() as Attachment; return a.memberId ? null : a.authBy; })]
      .filter((value): value is number => value != null);
    await this.ctx.storage.transaction(async transaction => {
      await transaction.put('table', session.data);
      for (const [handId, record] of session.archives) {
        await transaction.put(keyFor(handId), record);
        if (handId > MAX_HISTORY) await transaction.delete(keyFor(handId - MAX_HISTORY));
      }
      await transaction.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
    });
  }
  private async commitAndBroadcast(session: TableSession, started: number,
    extra: { socket: WebSocket; payload: string }[] = []) {
    const online = this.online(session);
    const messages = [...extra];
    for (const socket of this.sockets()) {
      const memberId = (socket.deserializeAttachment() as Attachment).memberId;
      const member = session.data.members.find(value => value.id === memberId);
      if (member) messages.push({ socket, payload: JSON.stringify(session.snapshot(member, online)) });
    }
    session.data.usage.messagesOut += messages.length;
    session.data.usage.bytesOut += messages.reduce((total, item) => total + encoder.encode(item.payload).byteLength, 0);
    await this.commit(session, started);
    for (const { socket, payload } of messages) { try { socket.send(payload); } catch { try { socket.close(1011); } catch {} } }
  }
  private async release(id: string) {
    await this.env.DIRECTORY.getByName('preview').fetch('https://internal/release', { method: 'POST', body: JSON.stringify({ id }) });
  }
}
