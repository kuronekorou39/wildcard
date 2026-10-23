import type { Action, Variant, VisibleState } from '@wildcard/engine';
import type { TableRuntimeSnapshot } from './runtime.js';

export const SERVER_PROTOCOL = 1;
export type PlayerCommand =
  | { readonly type: 'fold' | 'check' | 'call' }
  | { readonly type: 'raise'; readonly to: number }
  | { readonly type: 'showCard'; readonly index: number }
  | { readonly type: 'setStraddle'; readonly on: boolean }
  | { readonly type: 'setAway'; readonly away: boolean }
  | { readonly type: 'runItTwice'; readonly agree: boolean };
export type TableCommand = PlayerCommand | { readonly type: 'start' } | { readonly type: 'pause' } | { readonly type: 'close' };
export interface CommandRequest {
  readonly type: 'command';
  readonly id: string;
  readonly seq: number;
  readonly handId: number;
  readonly turnId: number | null;
  readonly command: TableCommand;
}
export interface CommandReceipt {
  readonly id: string;
  readonly seq: number;
  readonly ok: boolean;
  readonly message: string | null;
}
export interface TableOptions {
  readonly name: string;
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly seatCount: number;
  readonly hostPlays: boolean;
  readonly variant: Variant;
}
export interface ServerSnapshot {
  readonly type: 'snapshot';
  readonly protocol: typeof SERVER_PROTOCOL;
  readonly revision: number;
  readonly serverNow: number;
  readonly state: VisibleState;
  readonly runtime: TableRuntimeSnapshot;
  readonly viewerId: string | null;
  readonly owner: boolean;
  readonly closed: boolean;
  readonly expiresAt: number;
  readonly online: readonly string[];
  readonly lastReceipt: CommandReceipt | null;
  readonly startRejection: string | null;
}
export interface SavedHand {
  readonly handId: number;
  readonly endedAt: number;
  readonly state: VisibleState;
}
export type ServerMessage = ServerSnapshot
  | { readonly type: 'receipt'; readonly receipt: CommandReceipt }
  | { readonly type: 'error'; readonly message: string; readonly fatal?: boolean };

/** Client actions never grant authority over player IDs, chips, timeout or dealing. */
export function playerCommand(action: Action): PlayerCommand | null {
  switch (action.type) {
    case 'fold': case 'check': case 'call': return { type: action.type };
    case 'raise': return { type: action.type, to: action.to };
    case 'showCard': return { type: action.type, index: action.index };
    case 'setStraddle': return { type: action.type, on: action.on };
    case 'setAway': return { type: action.type, away: action.away };
    case 'runItTwice': return { type: action.type, agree: action.agree };
    default: return null;
  }
}

export function parseCommand(value: unknown): CommandRequest | null {
  if (!isRecord(value) || value.type !== 'command' || typeof value.id !== 'string' || !/^[\w-]{8,80}$/.test(value.id) ||
      !Number.isSafeInteger(value.seq) || (value.seq as number) < 1 ||
      !Number.isSafeInteger(value.handId) || (value.handId as number) < 0 ||
      !(value.turnId === null || Number.isSafeInteger(value.turnId))) return null;
  const command = value.command;
  if (!isRecord(command)) return null;
  let keys: string[] = ['type'];
  switch (command.type) {
    case 'start': case 'pause': case 'close': case 'fold': case 'check': case 'call': break;
    case 'raise': if (!Number.isSafeInteger(command.to) || (command.to as number) < 0) return null; keys.push('to'); break;
    case 'showCard': if (!Number.isSafeInteger(command.index) || (command.index as number) < 0) return null; keys.push('index'); break;
    case 'setStraddle': if (typeof command.on !== 'boolean') return null; keys.push('on'); break;
    case 'setAway': if (typeof command.away !== 'boolean') return null; keys.push('away'); break;
    case 'runItTwice': if (typeof command.agree !== 'boolean') return null; keys.push('agree'); break;
    default: return null;
  }
  if (Object.keys(command).some(key => !keys.includes(key))) return null;
  return value as unknown as CommandRequest;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
