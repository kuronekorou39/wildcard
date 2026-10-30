import { validate, type Action, type GameState } from '@wildcard/engine';
import { addChips, contributedChips, TABLE_TIMING as T, type ChipStack, type PostedBet } from './presentation.js';

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
  | { readonly kind: 'bet' | 'win'; readonly playerId: string; readonly amount: number; readonly raised?: boolean }
  | { readonly kind: 'fold' | 'check'; readonly playerId: string }
  | { readonly kind: 'collect'; readonly bets: readonly PostedBet[] }
);
export interface TableRuntimeSnapshot {
  readonly handId: number;
  readonly handStartedAt: number | null;
  readonly clock: TurnClock | null;
  readonly events: readonly TableEvent[];
  readonly readyAt: number;
  readonly nextHandAt: number | null;
  /** All contributed chips, including the bets still in front of each player. */
  readonly potChips: readonly ChipStack[];
  readonly bets: readonly PostedBet[];
  /** Public showdown hands may open here, before the remaining board animations. */
  readonly runoutAt?: number | null;
  /** Open hands only after the final collection/board has had a quiet beat. */
  readonly showdownAt?: number | null;
}

export const isDecision = (action: Action) =>
  ['fold', 'check', 'call', 'raise', 'timeout', 'runItTwice'].includes(action.type);

/** Host/local authority for real deadlines. The pure poker engine remains independent of time. */
export class TableRuntime {
  private value: TableRuntimeSnapshot = { handId: 0, handStartedAt: null, clock: null, events: [], readyAt: 0, nextHandAt: null, potChips: [], bets: [] };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private nextFired = false;
  private turnSequence = 0;
  private eventSequence = 0;
  private active = true;
  constructor(private readonly onTimeout: (playerId: string) => void,
    private readonly durationMs = TURN_TIME_MS, private readonly waitForReveal = false,
    private readonly options: {
      readonly paced?: boolean; readonly onNextHand?: () => void; readonly nextHandDelayMs?: number;
      /** Server authorities persist deadlines and schedule them outside this class. */
      readonly manual?: boolean; readonly now?: () => number; readonly restored?: TableRuntimeSnapshot;
    } = {}) {
    if (options.restored) {
      this.value = options.restored;
      this.turnSequence = options.restored.clock?.id ?? 0;
      this.eventSequence = Math.max(0, ...options.restored.events.map(event => event.id));
    }
  }

  private now() { return this.options.now?.() ?? Date.now(); }

  snapshot() { return this.value; }

  advance(before: GameState, after: GameState, action: Action) {
    const now = this.now();
    const handId = this.value.handId + (action.type === 'startHand' ? 1 : 0);
    const handStartedAt = action.type === 'startHand' ? now : this.value.handStartedAt;
    const events = action.type === 'startHand' ? [] : this.value.events.filter(e => now - e.at < T.history);
    let potChips = action.type === 'startHand' ? [] : this.value.potChips;
    let bets: readonly PostedBet[] = action.type === 'startHand' ? [] : this.value.bets;
    const append = (event: Omit<Extract<TableEvent, { kind: 'deal' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'burn' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'board' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'collect' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'bet' | 'win' }>, 'id' | 'at'> |
      Omit<Extract<TableEvent, { kind: 'fold' | 'check' }>, 'id' | 'at'>, at = now) => {
      events.push({ ...event, id: ++this.eventSequence, at } as TableEvent);
    };
    let readyAt = now;
    if (action.type === 'check' || (action.type === 'timeout' && before.phase === 'betting' && before.currentBet === before.players.find(p => p.id === action.playerId)?.bet)) {
      append({ kind: 'check', playerId: action.playerId });
    }
    if (action.type === 'startHand') append({ kind: 'deal' });
    if (action.type === 'startHand') {
      const cards = Math.max(0, ...after.players.map(p => p.holeCards.length));
      readyAt = now + T.dealReveal + Math.max(0, cards * after.seatCount - 1) * T.dealGap + T.card + T.streetPause;
    }
    for (const player of after.players) {
      const previous = before.players.find(p => p.id === player.id);
      const paid = after.phase === 'showdown' && before.phase !== 'showdown'
        ? (previous?.chips ?? 0) + (after.summary?.payouts.find(p => p.playerId === player.id)?.amount ?? 0) - player.chips
        : player.committed - (action.type === 'startHand' ? 0 : previous?.committed ?? 0);
      if (paid > 0) {
        // Antes go straight to the pot; live blinds and voluntary bets stay in front.
        const ante = action.type === 'startHand' && player.inHand ? Math.min(previous?.chips ?? 0, after.ante ?? 0) : 0;
        const posted = Math.max(0, paid - ante);
        const chips = contributedChips(posted);
        potChips = addChips(potChips, addChips(chips, contributedChips(paid - posted)));
        if (posted > 0) {
          append({ kind: 'bet', playerId: player.id, amount: posted, ...(action.type === 'raise' ? { raised: true } : {}) });
          const previousBet = bets.find(bet => bet.playerId === player.id);
          bets = [...bets.filter(bet => bet.playerId !== player.id), { playerId: player.id, chips: addChips(previousBet?.chips ?? [], chips) }];
          readyAt = Math.max(readyAt, now + T.bet);
        }
      }
      if (player.folded && previous && !previous.folded) {
        append({ kind: 'fold', playerId: player.id });
        readyAt = Math.max(readyAt, now + T.card);
      }
    }
    // Resetting the street for a NEW hand must not sweep its live blinds.
    const roundEnded = action.type === 'startHand' ? after.phase !== 'betting'
      : before.streetIndex !== after.streetIndex || (before.phase === 'betting' && after.phase !== 'betting');
    if (roundEnded && bets.length) {
      readyAt += T.collectPause;
      append({ kind: 'collect', bets }, readyAt);
      bets = [];
      readyAt += T.collect;
    }
    const startingRunout = after.phase === 'showdown' && before.phase !== 'showdown' && (after.summary?.revealed.length ?? 0) > 1 &&
      (after.communityCards.length > before.communityCards.length || after.extraBoards.length > before.extraBoards.length);
    const runoutAt = startingRunout ? readyAt + T.showdownPause : action.type === 'startHand' ? null : this.value.runoutAt ?? null;
    if (startingRunout) readyAt = runoutAt! + T.showdownReveal;
    let burned = Math.max(0, after.burned.length - before.burned.length);
    const previousBoards = [before.communityCards, ...before.extraBoards];
    [after.communityCards, ...after.extraBoards].forEach((board, run) => {
      const from = previousBoards[run]?.length ?? before.communityCards.length;
      let offset = 0;
      for (const street of after.variant.structure.streets) {
        const end = offset + street.cards;
        const first = Math.max(from, offset);
        if (board.length > first && end > from) {
          readyAt += T.streetPause;
          const burnCount = Math.min(burned, street.burn ?? 0);
          if (burnCount > 0) {
            append({ kind: 'burn', count: burnCount }, readyAt);
            burned -= burnCount;
            readyAt += T.card + (burnCount - 1) * T.dealGap;
          }
          const count = Math.min(board.length, end) - first;
          append({ kind: 'board', run, from: first, count }, readyAt);
          readyAt += T.card + (count - 1) * T.boardGap;
        }
        offset = end;
      }
    });
    const ended = after.phase === 'showdown' && before.phase !== 'showdown';
    let showdownAt = action.type === 'startHand' ? null : this.value.showdownAt ?? null;
    if (ended) {
      readyAt += T.showdownPause;
      showdownAt = readyAt;
      if ((after.summary?.revealed.length ?? 0) > 1) readyAt += T.showdownReveal;
      for (const payout of after.summary?.payouts ?? []) append({ kind: 'win', ...payout }, readyAt);
      readyAt += T.win;
    }
    const changedTurn = before.turnPlayerId !== after.turnPlayerId || before.phase !== after.phase ||
      before.streetIndex !== after.streetIndex || isDecision(action);
    readyAt = this.options.paced ? (changedTurn ? readyAt : this.value.readyAt) : now;

    let clock = this.value.clock;
    if (!after.turnPlayerId || !['betting', 'runChoice'].includes(after.phase)) {
      clock = null;
      this.clearTimer();
    } else if (changedTurn) {
      this.clearTimer();
      clock = { id: ++this.turnSequence, playerId: after.turnPlayerId, durationMs: this.durationMs,
        startedAt: this.waitForReveal ? null : readyAt, deadline: this.waitForReveal ? null : readyAt + this.durationMs };
    }
    let nextHandAt = this.value.nextHandAt;
    if (action.type === 'startHand' || after.phase !== 'showdown') {
      nextHandAt = null; this.clearNextTimer(); this.nextFired = false;
    } else if (ended && this.options.onNextHand && validate(after, { type: 'startHand', seed: 0 }) === null) {
      nextHandAt = readyAt + (this.options.nextHandDelayMs ?? T.nextHand);
      this.nextFired = false;
    } else if (nextHandAt !== null && validate(after, { type: 'startHand', seed: 0 }) !== null) {
      nextHandAt = null; this.clearNextTimer();
    }
    this.value = { handId, handStartedAt, clock, events: events.slice(-80), readyAt, nextHandAt, potChips, bets, runoutAt, showdownAt };
    this.schedule();
  }

  /** Hotseat starts counting only once the intended player reveals the table. */
  revealTurn() {
    const clock = this.value.clock;
    if (!clock || clock.deadline !== null) return false;
    const now = Math.max(this.now(), this.value.readyAt);
    this.value = { ...this.value, clock: { ...clock, startedAt: now, deadline: now + clock.durationMs } };
    this.schedule();
    return true;
  }

  resume() { this.active = true; this.schedule(); }
  dispose() { this.active = false; this.clearTimer(); this.clearNextTimer(); }
  cancelNextHand() {
    this.clearNextTimer();
    this.nextFired = true;
    this.value = { ...this.value, nextHandAt: null };
  }
  private clearNextTimer() { if (this.nextTimer !== null) clearTimeout(this.nextTimer); this.nextTimer = null; }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    if (this.options.manual) return;
    if (this.active && this.nextTimer === null && !this.nextFired && this.value.nextHandAt !== null) {
      this.nextTimer = setTimeout(() => {
        this.nextTimer = null;
        if (!this.active || this.nextFired) return;
        this.nextFired = true;
        this.options.onNextHand?.();
      }, Math.max(0, this.value.nextHandAt - Date.now()));
      this.nextTimer.unref?.();
    }
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
    runoutAt: value.runoutAt == null ? null : value.runoutAt + offset,
    showdownAt: value.showdownAt == null ? null : value.showdownAt + offset,
    readyAt: value.readyAt + offset,
    nextHandAt: value.nextHandAt === null ? null : value.nextHandAt + offset,
    handStartedAt: value.handStartedAt === null ? null : value.handStartedAt + offset,
    clock: value.clock && { ...value.clock,
      startedAt: value.clock.startedAt === null ? null : value.clock.startedAt + offset,
      deadline: value.clock.deadline === null ? null : value.clock.deadline + offset },
    events: value.events.map(event => ({ ...event, at: event.at + offset })),
  };
}
