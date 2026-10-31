import type { CommandRequest, TableOptions } from '@wildcard/table';

export interface ServerSettings { readonly serverUrl: string; readonly tableId: string; readonly name: string; readonly token: string }
export interface StoredConnection extends ServerSettings { readonly pending?: CommandRequest | null }
const endpointKey = 'wildcard.server-url.v1';
const roomPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('接続先は HTTPS のサーバーURLを指定してください');
  return url.origin;
}
export function defaultServerUrl(): string {
  try {
    const value = localStorage.getItem(endpointKey) || import.meta.env.VITE_TABLE_SERVER_URL || (import.meta.env.DEV ? 'http://127.0.0.1:8787' : '');
    return value ? normalizeServerUrl(value) : '';
  } catch { return ''; }
}
export function saveServerUrl(value: string) { localStorage.setItem(endpointKey, normalizeServerUrl(value)); }
const storageKey = (server: string, table: string) => `wildcard.server-session.v1:${server}:${table}`;
export function loadConnection(server: string, table: string): StoredConnection | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(server, table)) ?? 'null') as StoredConnection | null;
    return value && value.serverUrl === server && value.tableId === table && typeof value.name === 'string' && /^[a-f0-9]{64}$/i.test(value.token) ? value : null;
  } catch { return null; }
}
export function saveConnection(connection: StoredConnection) {
  try { localStorage.setItem(storageKey(connection.serverUrl, connection.tableId), JSON.stringify(connection)); }
  catch { throw new Error('再接続の情報を保存できません。ブラウザの保存領域を確認してください'); }
}
export function forgetConnection(settings: ServerSettings) {
  localStorage.removeItem(storageKey(settings.serverUrl, settings.tableId));
}
export class ServerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/**
 * 応答が読めないときの説明。Cloudflare の日次上限（無料枠）に達した応答は CORS ヘッダが無く、
 * ブラウザからは通信断と区別できないので、両方の可能性を書く。
 */
export const UNREACHABLE_SERVER = 'サーバーに接続できません。通信環境の問題か、サーバーが本日の利用上限に達している可能性があります（上限は日本時間 9:00 に戻ります）。';
export function connectionToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function tableIdFrom(value: string): string | null {
  const input = value.trim();
  if (roomPattern.test(input)) return input;
  try { const id = new URLSearchParams(new URL(input).hash.slice(1)).get('table'); return id && roomPattern.test(id) ? id : null; }
  catch { return null; }
}
export function invitedTable(): string | null { return typeof window === 'undefined' ? null : tableIdFrom(window.location.href); }
export function inviteLink(tableId: string) {
  const url = new URL(window.location.href); url.hash = new URLSearchParams({ table: tableId }).toString(); return url.href;
}
export async function serverRequest(settings: Pick<ServerSettings, 'serverUrl' | 'tableId' | 'token'>, path = '', init: RequestInit = {}) {
  const response = await fetch(`${settings.serverUrl}/api/tables/${settings.tableId}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}`, ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new ServerRequestError(typeof value === 'object' && value && 'error' in value ? String(value.error) : 'サーバーに接続できませんでした', response.status);
  return value;
}
export async function createServerTable(settings: ServerSettings, options: TableOptions, createKey: string) {
  return serverRequest(settings, '', { method: 'PUT', headers: { Authorization: `Bearer ${createKey}` },
    body: JSON.stringify({ token: settings.token, options }) });
}
