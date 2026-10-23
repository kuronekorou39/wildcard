import { createGame, deckSize, parseVariant, project, reduce, validate, validateVariant,
  type Action, type GameState } from '@wildcard/engine';
import { isDecision, isRecord, SERVER_PROTOCOL, TableRuntime, TURN_TIME_MS,
  type CommandReceipt, type CommandRequest, type ServerSnapshot, type TableOptions,
  type TableRuntimeSnapshot } from '@wildcard/table';

export interface Member {
  id: string;
  playerId: string | null;
  name: string;
  tokenHash: string;
  owner: boolean;
  autoAway: boolean;
  lastReceipt: CommandReceipt | null;
  lastRequest: string | null;
}
export interface Usage {
  commands: number; accepted: number; rejected: number; duplicate: number;
  alarms: number; hands: number; connections: number; messagesIn: number;
  messagesOut: number; bytesIn: number; bytesOut: number; stateWrites: number;
  historyWrites: number; activeMs: number; handlerMs: number;
}
export interface StoredTable {
  schema: 1;
  id: string;
  options: TableOptions;
  game: GameState;
  runtime: TableRuntimeSnapshot;
  members: Member[];
  revision: number;
  createdAt: number;
  expiresAt: number;
  cleanupAt?: number;
  closed: boolean;
  usage: Usage;
  accountedAt: number;
}
export interface StoredHand { handId: number; endedAt: number; game: GameState }
export const MAX_HISTORY = 100;
export const MAX_MEMBERS = 20;

export function readOptions(value: unknown): TableOptions {
  if (!isRecord(value)) throw new Error('卓の設定が不正です');
  const parsed = parseVariant(value.variant);
  if (!parsed.ok) throw new Error('ルールの形式が不正です');
  const name = readName(value.name);
  const { chips, smallBlind, bigBlind, seatCount, hostPlays } = value;
  if (![chips, smallBlind, bigBlind, seatCount].every(Number.isSafeInteger) || typeof hostPlays !== 'boolean' ||
      (seatCount as number) < 2 || (seatCount as number) > 10 || (smallBlind as number) < 1 ||
      (bigBlind as number) < (smallBlind as number) || (chips as number) < (bigBlind as number) ||
      (chips as number) > 1_000_000_000) throw new Error('人数・チップ・ブラインドの設定が不正です');
  const problems = validateVariant(parsed.variant, seatCount as number);
  if (problems.length) throw new Error(problems[0]!.message);
  return { name, chips: chips as number, smallBlind: smallBlind as number, bigBlind: bigBlind as number,
    seatCount: seatCount as number, hostPlays, variant: parsed.variant };
}
export function readName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('名前は1〜24文字で入力してください');
  }
  return value.trim();
}

/** All randomness is obtained by the server before invoking the pure engine. */
export function dealEntropy(game: GameState): number[] {
  const words = new Uint32Array((deckSize(game.variant.deck) + 4) * 12);
  crypto.getRandomValues(words);
  return Array.from(words);
}

/** One request works on one persisted document; the adapter commits it with the alarm and history. */
export class TableSession {
  readonly archives = new Map<number, StoredHand>();
  private runtime: TableRuntime;
  constructor(readonly data: StoredTable, private readonly now: number,
    private readonly entropy: (game: GameState) => readonly number[] = dealEntropy) {
    this.runtime = new TableRuntime(() => {}, TURN_TIME_MS, false, {
      paced: true, manual: true, now: () => this.now, restored: data.runtime, onNextHand: () => {},
    });
  }

  static create(id: string, options: TableOptions, tokenHash: string, now: number, ttlMs: number): TableSession {
    const runtime = new TableRuntime(() => {}, TURN_TIME_MS, false, { manual: true }).snapshot();
    const data: StoredTable = {
      schema: 1, id, options, game: createGame(options), runtime, members: [], revision: 0,
      createdAt: now, expiresAt: now + ttlMs, closed: false, accountedAt: now,
      usage: { commands: 0, accepted: 0, rejected: 0, duplicate: 0, alarms: 0, hands: 0,
        connections: 0, messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0, stateWrites: 0,
        historyWrites: 0, activeMs: 0, handlerMs: 0 },
    };
    const session = new TableSession(data, now);
    session.join(tokenHash, options.name, options.hostPlays, true);
    return session;
  }

  member(tokenHash: string) { return this.data.members.find(member => member.tokenHash === tokenHash); }

  join(tokenHash: string, name: string, play: boolean, owner = false): Member {
    const existing = this.member(tokenHash);
    if (existing) return existing;
    if (this.data.closed) throw new Error('この卓は終了しました');
    if (this.now >= this.data.expiresAt) throw new Error('この検証卓の保存期間が終了しました');
    if (this.data.members.length >= MAX_MEMBERS) throw new Error('この卓の参加人数が上限に達しました');
    const seat = Array.from({ length: this.data.game.seatCount }, (_, index) => index)
      .find(index => !this.data.game.players.some(player => player.seat === index));
    if (play && seat === undefined) throw new Error('満席です。観戦で参加できます');
    const id = crypto.randomUUID();
    const member: Member = { id, playerId: play ? id : null, name, tokenHash, owner, autoAway: false,
      lastReceipt: null, lastRequest: null };
    this.data.members.push(member);
    if (play) this.apply({ type: 'sit', playerId: id, name, seat: seat!, chips: this.data.options.chips });
    this.data.revision++;
    return member;
  }

  connected(member: Member) {
    if (member.autoAway && member.playerId) {
      this.apply({ type: 'setAway', playerId: member.playerId, away: false });
      member.autoAway = false;
    }
  }

  /** Advance only from saved deadlines. Repeating an alarm cannot repeat the transition. */
  tick(online: readonly string[]) {
    this.account();
    if (this.data.closed) return;
    const clock = this.data.runtime.clock;
    if (clock?.deadline != null && this.now >= clock.deadline) {
      this.apply({ type: 'timeout', playerId: clock.playerId });
    }
    const next = this.data.runtime.nextHandAt;
    if (next !== null && this.now >= next) {
      if (this.startReason(online) === null) this.start(online);
      else { this.runtime.cancelNextHand(); this.sync(); }
    }
  }

  command(member: Member, request: CommandRequest, online: readonly string[]): CommandReceipt {
    this.data.usage.commands++;
    const signature = JSON.stringify([request.handId, request.turnId, request.command]);
    if (member.lastReceipt && request.seq === member.lastReceipt.seq && request.id === member.lastReceipt.id && signature === member.lastRequest) {
      this.data.usage.duplicate++;
      return member.lastReceipt;
    }
    const fail = (message: string): CommandReceipt => ({ id: request.id, seq: request.seq, ok: false, message });
    if (request.seq !== (member.lastReceipt?.seq ?? 0) + 1) return fail('操作番号が古いか、順序が違います。再接続してください');
    let message: string | null = null;
    const command = request.command;
    if (this.data.closed) message = 'この卓は終了しました';
    else if (request.handId !== this.data.runtime.handId) message = 'ハンドが切り替わりました';
    else if (command.type === 'start' || command.type === 'pause' || command.type === 'close') {
      if (!member.owner) message = '主催者のみ操作できます';
      else if (command.type === 'start') {
        message = this.startReason(online);
        if (!message) this.start(online);
      } else if (command.type === 'pause') {
        this.runtime.cancelNextHand(); this.sync();
      } else if (!['waiting', 'showdown'].includes(this.data.game.phase) || this.now < this.data.runtime.readyAt) {
        message = 'ハンドの終了後に卓を終了できます';
      } else {
        this.data.closed = true;
        this.runtime.cancelNextHand(); this.sync();
      }
    } else if (!member.playerId) message = '観戦中は操作できません';
    else {
      const action: Action = { ...command, playerId: member.playerId };
      if (isDecision(action) && request.turnId !== this.data.runtime.clock?.id) message = '手番が切り替わりました';
      else if (isDecision(action) && this.now < this.data.runtime.readyAt) message = '配牌・チップの移動が終わるまでお待ちください';
      else message = validate(this.data.game, action)?.reason ?? null;
      if (!message) {
        this.apply(action);
        if (command.type === 'setAway') member.autoAway = false;
      }
    }
    const receipt: CommandReceipt = { id: request.id, seq: request.seq, ok: message === null, message };
    member.lastReceipt = receipt;
    member.lastRequest = signature;
    this.data.usage[message === null ? 'accepted' : 'rejected']++;
    this.data.revision++;
    return receipt;
  }

  startReason(online: readonly string[]): string | null {
    if (this.data.closed) return 'この卓は終了しました';
    if (this.now >= this.data.expiresAt) return 'この検証卓の保存期間が終了しました';
    if (!['waiting', 'showdown'].includes(this.data.game.phase)) return 'ハンドの進行中です';
    if (this.now < this.data.runtime.readyAt) return '結果の表示を待っています';
    const game = this.readyPlayers(online);
    return validate(game, { type: 'startHand', seed: 0 })?.reason ?? null;
  }

  snapshot(member: Member, online: readonly string[]): ServerSnapshot {
    return {
      type: 'snapshot', protocol: SERVER_PROTOCOL, revision: this.data.revision, serverNow: this.now,
      state: project(this.data.game, member.playerId), runtime: this.data.runtime,
      viewerId: member.playerId, owner: member.owner, closed: this.data.closed,
      expiresAt: this.data.expiresAt, online, lastReceipt: member.lastReceipt,
      startRejection: this.startReason(online),
    };
  }

  private readyPlayers(online: readonly string[]): GameState {
    return { ...this.data.game, players: this.data.game.players.map(player => ({ ...player,
      away: player.away || !online.includes(player.id) })) };
  }

  private start(online: readonly string[]) {
    for (const member of this.data.members) {
      const player = this.data.game.players.find(value => value.id === member.playerId);
      if (player && !player.away && !online.includes(player.id)) {
        member.autoAway = true;
        this.apply({ type: 'setAway', playerId: player.id, away: true });
      }
    }
    this.apply({ type: 'startHand', seed: 0, entropy: this.entropy(this.data.game) });
    this.data.usage.hands++;
  }

  private apply(action: Action) {
    const before = this.data.game;
    const after = reduce(before, action);
    if (after === before) return;
    this.runtime.advance(before, after, action);
    this.data.game = after;
    this.sync();
    this.data.revision++;
    if (after.phase === 'showdown' && after.summary && (before.phase !== 'showdown' || action.type === 'showCard')) {
      this.archives.set(this.data.runtime.handId, { handId: this.data.runtime.handId, endedAt: this.now, game: after });
    }
  }
  private sync() { this.data.runtime = this.runtime.snapshot(); }
  private account() {
    if (['betting', 'runChoice'].includes(this.data.game.phase)) {
      this.data.usage.activeMs += Math.max(0, Math.min(this.now, this.data.runtime.clock?.deadline ?? this.now) - this.data.accountedAt);
    }
    this.data.accountedAt = this.now;
  }
}
