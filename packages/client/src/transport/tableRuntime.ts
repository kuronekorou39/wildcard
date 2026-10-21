import type { Action, GameState } from '@wildcard/engine';

export const TURN_TIME_MS = 30_000;
export interface TurnClock {
  readonly id: number;
  readonly playerId: string;
  readonly durationMs: number;
  readonly startedAt: number | null;
  readonly deadline: number | null;
}
export type TableEvent = { readonly id: number; readonly at: number } & (
  | { readonly kind: 'deal' }
  | { readonly kind: 'burn'; readonly count: number }
  | { readonly kind: 'board'; readonly run: number; readonly from: number; readonly count: number }
  | { readonly kind: 'bet' | 'win'; readonly playerId: string; readonly amount: number }
  | { readonly kind: 'fold'; readonly playerId: string }
);
export interface TableRuntimeSnapshot {
  readonly handId: number;
  readonly handStartedAt: number | null;
  readonly clock: TurnClock | null;
  readonly events: readonly TableEvent[];
}

export const isDecision = (action: Action) =>
  ['fold', 'check', 'call', 'raise', 'timeout', 'runItTwice'].includes(action.type);

/** Host/local authority for real deadlines. The pure poker engine remains independent of time. */
export class TableRuntime {
  private value: TableRuntimeSnapshot = { handId: 0, handStartedAt: null, clock: null, events: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turnSequence = 0;
  private eventSequence = 0;
  private active = true;
  constructor(private readonly onTimeout: (playerId: string) => void,
    private readonly durationMs = TURN_TIME_MS, private readonly waitForReveal = false) {}

  snapshot() { return this.value; }

  advance(before: GameState, after: GameState, action: Action) {
    const now = Date.now();
    const handId = this.value.handId + (action.type === 'startHand' ? 1 : 0);
    const handStartedAt = action.type === 'startHand' ? now : this.value.handStartedAt;
    const events = action.type === 'startHand' ? [] : this.value.events.filter(e => now - e.at < 2200);
    const append = (event: Omit<Extract<TableEvent, { kind: 'deal' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'burn' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'board' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'bet' | 'win' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'fold' }>, 'id' | 'at'>) => {
      events.push({ ...event, id: ++this.eventSequence, at: now } as TableEvent);
    };
    if (action.type === 'startHand') append({ kind: 'deal' });
    for (const player of after.players) {
      const previous = before.players.find(p => p.id === player.id);
      const paid = after.phase === 'showdown' && before.phase !== 'showdown'
        ? (previous?.chips ?? 0) + (after.summary?.payouts.find(p => p.playerId === player.id)?.amount ?? 0) - player.chips
        : player.committed - (action.type === 'startHand' ? 0 : previous?.committed ?? 0);
      if (paid > 0) append({ kind: 'bet', playerId: player.id, amount: paid });
      if (player.folded && previous && !previous.folded) append({ kind: 'fold', playerId: player.id });
    }
    const burned = after.burned.length - before.burned.length;
    if (burned > 0 && action.type !== 'startHand') append({ kind: 'burn', count: burned });
    const previousBoards = [before.communityCards, ...before.extraBoards];
    [after.communityCards, ...after.extraBoards].forEach((board, run) => {
      const from = previousBoards[run]?.length ?? before.communityCards.length;
      if (board.length > from) append({ kind: 'board', run, from, count: board.length - from });
    });
    if (after.phase === 'showdown' && before.phase !== 'showdown')
      for (const payout of after.summary?.payouts ?? []) append({ kind: 'win', ...payout });

    let clock = this.value.clock;
    if (!after.turnPlayerId || !['betting', 'runChoice'].includes(after.phase)) {
      clock = null;
      this.clearTimer();
    } else if (before.turnPlayerId !== after.turnPlayerId || before.phase !== after.phase ||
      before.streetIndex !== after.streetIndex || isDecision(action)) {
      this.clearTimer();
      clock = { id: ++this.turnSequence, playerId: after.turnPlayerId, durationMs: this.durationMs,
        startedAt: this.waitForReveal ? null : now, deadline: this.waitForReveal ? null : now + this.durationMs };
    }
    this.value = { handId, handStartedAt, clock, events: events.slice(-80) };
    this.schedule();
  }

  /** Hotseat starts counting only once the intended player reveals the table. */
  revealTurn() {
    const clock = this.value.clock;
    if (!clock || clock.deadline !== null) return false;
    const now = Date.now();
    this.value = { ...this.value, clock: { ...clock, startedAt: now, deadline: now + clock.durationMs } };
    this.schedule();
    return true;
  }

  resume() { this.active = true; this.schedule(); }
  dispose() { this.active = false; this.clearTimer(); }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    const clock = this.value.clock;
    if (!this.active || this.timer !== null || !clock || clock.deadline === null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active && this.value.clock?.id === clock.id) this.onTimeout(clock.playerId);
    }, Math.max(0, clock.deadline - Date.now()));
    this.timer.unref?.();
  }
}

/** Convert host time to the receiving browser's clock without relying on synchronized OS clocks. */
export function receiveRuntime(value: TableRuntimeSnapshot, serverNow: number): TableRuntimeSnapshot {
  const offset = Date.now() - serverNow;
  return { ...value,
    handStartedAt: value.handStartedAt === null ? null : value.handStartedAt + offset,
    clock: value.clock && { ...value.clock,
      startedAt: value.clock.startedAt === null ? null : value.clock.startedAt + offset,
      deadline: value.clock.deadline === null ? null : value.clock.deadline + offset },
    events: value.events.map(event => ({ ...event, at: event.at + offset })),
  };
}
