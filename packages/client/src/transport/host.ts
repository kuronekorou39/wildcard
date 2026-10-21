import {
  type Action,
  type CreateGameOptions,
  type GameState,
  type HandRecord,
  type NonceEntry,
  commitOf,
  createGame,
  deriveSeed,
  project,
  randomHex,
  reduce,
  validate,
} from '@wildcard/engine';
import { NET_CONFIG } from '../net/config.js';
import { diagLog } from '../net/diag.js';
import type { PeerLink } from '../net/peerLink.js';
import {
  MSG,
  PROTO_VERSION,
  authorizeAction,
  parseGuestMessage,
  type HostMessage,
} from '../net/protocol.js';
import type { TableSnapshot, Transport } from './types.js';
import { isDecision, TableRuntime } from './tableRuntime.js';

export interface HostTransportOptions extends CreateGameOptions {
  readonly paced?: boolean;
  readonly autoNextHandMs?: number;
  readonly turnTimeMs?: number;
  readonly link: PeerLink;
  readonly roomCode: string;
  readonly hostName: string;
  /**
   * host 自身も席に着くか。
   *
   * false にすると host は中立のディーラーになる。このとき host の画面は
   * project(state, null) を見るので、**誰のホールカードも表示されない**。
   * 開発者ツールで覗く余地は残るが、遊んでいる本人の画面に出ないという違いは大きい。
   * 遊ばない人が1人いるなら、この形が一番安全。
   */
  readonly hostPlays: boolean;
  readonly startingChips: number;
  /** 乱数を待つ時間。既定は NET_CONFIG.nonceTimeoutMs。テストで縮める。 */
  readonly nonceTimeoutMs?: number;
}

interface PeerInfo {
  readonly sessionId: string;
  readonly playerId: string;
  name: string;
}

/** 記録は後から埋まるので、書き換えられる形で持つ。 */
interface MutableRecord {
  readonly handNo: number;
  readonly commit: string;
  readonly secret: string;
  nonces: NonceEntry[];
  seedHex: string | null;
  aborted: boolean;
}

/** 乱数を集めている最中の状態。 */
interface PendingDeal {
  readonly handNo: number;
  readonly collected: Map<string, string>;
  readonly expected: number;
  resolve: (() => void) | null;
}

export interface StartHandResult {
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * host 側の Transport。
 *
 * エンジンを回すのはこの端末だけで、guest には **その人向けに伏せた状態** を
 * 宛先指定で送る。hayabuzz の host と同じ権威型だが、全員に同じスナップショットを
 * 配るのではなく人ごとに project() し直すのが違い。
 */
export class HostTransport implements Transport {
  private state: GameState;
  private cached: TableSnapshot;
  private readonly listeners = new Set<(snapshot: TableSnapshot) => void>();

  private readonly link: PeerLink;
  private readonly options: HostTransportOptions;
  /** 接続中のピア。peerId -> 席の持ち主 */
  private readonly peers = new Map<string, PeerInfo>();
  /** 再接続のため、切断後も sessionId と席の対応は残す。 */
  private readonly seatsBySession = new Map<string, string>();
  private readonly hostPlayerId: string;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly runtime: TableRuntime;
  private closed = false;
  private starting = false;
  private autoDealNote: string | null = null;

  /** 配牌の記録。セッション終了時にまとめて公開して検証してもらう。 */
  private readonly fairLog: MutableRecord[] = [];
  private pendingDeal: PendingDeal | null = null;
  private handCounter = 0;
  private revealed = false;

  constructor(options: HostTransportOptions) {
    const { link, roomCode, hostName, hostPlays, startingChips, turnTimeMs, paced = false, autoNextHandMs, nonceTimeoutMs: _nonceTimeout, ...gameOptions } = options;
    this.options = options;
    this.link = link;
    this.hostPlayerId = `host-${roomCode}`;
    this.runtime = new TableRuntime(playerId => this.apply({ type: 'timeout', playerId }), turnTimeMs, false, {
      paced, ...(autoNextHandMs !== undefined ? { nextHandDelayMs: autoNextHandMs, onNextHand: () => {
        void this.startHand().then(result => {
          if (!result.ok && !this.closed) { this.autoDealNote = result.reason; this.cancelNextHand(); }
        }).catch(() => {
          if (!this.closed) { this.autoDealNote = '配牌を開始できませんでした'; this.cancelNextHand(); }
        });
      } } : {}),
    });

    let state = createGame(gameOptions);
    if (hostPlays) {
      state = reduce(state, {
        type: 'sit',
        playerId: this.hostPlayerId,
        name: hostName,
        seat: 0,
        chips: startingChips,
      });
    }
    this.state = state;
    this.cached = this.compute();

    link.onMessage((message, peerId) => this.onMessage(message, peerId));
    link.onPeerJoin((peerId) => diagLog('guest接続', peerId.slice(0, 4)));
    link.onPeerLeave((peerId) => this.onPeerLeave(peerId));
  }

  // ---- Transport ----

  snapshot(): TableSnapshot {
    return this.cached;
  }

  subscribe(listener: (snapshot: TableSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** host 自身の操作。guest を経由しないので認可は不要。 */
  dispatch(action: Action): void {
    this.apply(action);
  }

  // ---- host 固有 ----

  async start(): Promise<void> {
    this.closed = false;
    this.runtime.resume();
    await this.link.join(this.options.roomCode);
    // 無音が続くと guest 側が切断と判断するので、変化がなくても定期的に配る。
    this.heartbeat = setInterval(() => this.broadcastState(), NET_CONFIG.hostHeartbeatMs);
  }

  /** 部屋を閉じる。単なる切断と区別して guest に伝える。 */
  close(): void {
    this.closed = true;
    this.runtime.dispose();
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.sendTo(undefined, { type: MSG.CLOSED });
    this.link.leave();
  }

  rawState(): GameState {
    return this.state;
  }

  /** 席が埋まっている人数（観戦の host は含まない）。 */
  seatedCount(): number {
    return this.state.players.length;
  }

  // ---- 配牌の公正さ ----

  /**
   * ハンドを始める。
   *
   * 配る前に秘密をコミットし、全員の乱数を集めてから seed を決める。
   * host は乱数を知らずに秘密を固定しているので、seed を狙えない。
   * 詳しい手順は engine の fair/commit.ts を参照。
   */
  async startHand(): Promise<StartHandResult> {
    if (this.closed) return { ok: false, reason: '卓は終了しています' };
    if (this.options.paced && Date.now() < this.runtime.snapshot().readyAt) return { ok: false, reason: '配当中' };
    this.autoDealNote = null;
    if (this.starting || this.pendingDeal !== null) {
      return { ok: false, reason: '前のハンドの準備中です' };
    }
    const rejection = validate(this.state, { type: 'startHand', seed: 0 });
    if (rejection !== null) return { ok: false, reason: rejection.reason };
    this.starting = true;
    try {
      const handNo = ++this.handCounter;
      const secret = randomHex();
      const commit = await commitOf(secret);
      if (this.closed) return { ok: false, reason: '卓は終了しています' };

      const record: MutableRecord = {
        handNo,
        commit,
        secret,
        nonces: [],
        seedHex: null,
        aborted: false,
      };
      this.fairLog.push(record);

      // 配る前にコミットを配る。これより後に届く乱数しか採らない。
      const expected = this.peers.size;
      const pending: PendingDeal = { handNo, collected: new Map(), expected, resolve: null };
      this.pendingDeal = pending;
      this.sendTo(undefined, { type: MSG.DEAL_COMMIT, handNo, commit });

      await this.waitForNonces(pending);
      this.pendingDeal = null;

      record.nonces = [...pending.collected.entries()].map(([playerId, nonce]) => ({
        playerId,
        nonce,
      }));

      if (record.nonces.length < expected) {
        // 揃わないまま配ると、誰かの乱数を外した seed になってしまう。
        record.aborted = true;
        this.sendTo(undefined, { type: MSG.DEAL_ABORT, handNo, nonces: record.nonces });
        diagLog('配牌中断', `hand=${handNo} ${record.nonces.length}/${expected}`);
        return { ok: false, reason: '全員の乱数が揃わなかったので配りませんでした' };
      }

      const { seed, seedHex } = await deriveSeed(secret, record.nonces);
      if (this.closed) return { ok: false, reason: '卓は終了しています' };
      record.seedHex = seedHex;

      // 先に seed を知らせてから配る。guest 側の記録が state より後にならないように。
      this.sendTo(undefined, { type: MSG.DEAL_SEED, handNo, nonces: record.nonces, seedHex });
      this.apply({ type: 'startHand', seed });
      return { ok: true, reason: null };
    } finally { this.starting = false; }
  }

  /** 秘密を全員に公開する。これで全ハンドを検証できるようになる。 */
  revealAll(): void {
    this.revealed = true;
    this.sendTo(undefined, {
      type: MSG.DEAL_REVEAL,
      secrets: this.fairLog.map((r) => ({ handNo: r.handNo, secret: r.secret })),
    });
    diagLog('秘密を公開', `${this.fairLog.length}ハンド`);
  }

  hasRevealed(): boolean {
    return this.revealed;
  }

  /** 検証用の記録。host 側は自分の秘密を最初から持っている。 */
  fairnessRecords(): HandRecord[] {
    return this.fairLog.map((r) => ({
      handNo: r.handNo,
      commit: r.commit,
      nonces: r.nonces,
      seedHex: r.seedHex,
      aborted: r.aborted,
      secret: this.revealed ? r.secret : null,
    }));
  }

  private waitForNonces(pending: PendingDeal): Promise<void> {
    if (pending.expected === 0) return Promise.resolve();
    // 相手が速いと、ここへ来る前に全部届いていることがある。
    // 先に確かめないと、揃っているのにタイムアウトまで待ってしまう。
    if (pending.collected.size >= pending.expected) return Promise.resolve();

    return new Promise((resolve) => {
      const timeout = this.options.nonceTimeoutMs ?? NET_CONFIG.nonceTimeoutMs;
      const timer = setTimeout(finish, timeout);
      function finish() {
        clearTimeout(timer);
        pending.resolve = null;
        resolve();
      }
      pending.resolve = finish;
    });
  }

  // ---- 内部 ----

  private onMessage(raw: unknown, peerId: string): void {
    const message = parseGuestMessage(raw);
    if (message === null) {
      diagLog('不正メッセージ', peerId.slice(0, 4));
      return;
    }

    if (message.type === MSG.HELLO) {
      this.onHello(message.proto, message.sessionId, message.name, peerId);
      return;
    }

    const peer = this.peers.get(peerId);
    if (peer === undefined) return; // hello 前のメッセージは無視

    if (message.type === MSG.DEAL_NONCE) {
      this.onNonce(message.handNo, message.nonce, peer.playerId);
      return;
    }

    // 形が正しいだけでは足りない。その席の持ち主かどうかを必ず確かめる。
    // ここを抜かすと「他人の名前で降りる」ができてしまう。
    if (!authorizeAction(message.action, peer.playerId)) {
      diagLog('認可拒否', `${peerId.slice(0, 4)} ${message.action.type}`);
      return;
    }

    // A delayed double tap must never become a decision in a later turn.
    if (isDecision(message.action) && message.turnId !== this.runtime.snapshot().clock?.id) return;
    this.apply(message.action);
  }

  /** 配る前に集めている乱数を受け取る。 */
  private onNonce(handNo: number, nonce: string, playerId: string): void {
    const pending = this.pendingDeal;
    if (pending === null || pending.handNo !== handNo) return; // 古い・知らないハンド
    if (pending.collected.has(playerId)) return; // 二重送信は最初のものだけ採る
    pending.collected.set(playerId, nonce);
    if (pending.collected.size >= pending.expected) pending.resolve?.();
  }

  private onHello(proto: number, sessionId: string, name: string, peerId: string): void {
    if (proto !== PROTO_VERSION) {
      this.sendTo(peerId, {
        type: MSG.REJECTED,
        reason: 'アプリの版が違います。両方とも再読み込みしてください。',
      });
      return;
    }

    const existingPlayerId = this.seatsBySession.get(sessionId);

    // 同じ sessionId が別のピアで既に繋がっているなら、乗っ取りを防ぐため拒否する。
    if (existingPlayerId !== undefined) {
      for (const [otherPeerId, info] of this.peers) {
        if (otherPeerId !== peerId && info.sessionId === sessionId) {
          this.sendTo(peerId, { type: MSG.REJECTED, reason: 'その席は別の端末が使用中です。' });
          return;
        }
      }
    }

    if (existingPlayerId !== undefined) {
      // 再接続。席とチップはそのままで、離席を解除する。
      this.peers.set(peerId, { sessionId, playerId: existingPlayerId, name });
      this.sendTo(peerId, {
        type: MSG.WELCOME,
        playerId: existingPlayerId,
        resumed: true,
        hostIsPlaying: this.options.hostPlays,
      });
      this.apply({ type: 'setAway', playerId: existingPlayerId, away: false });
      diagLog('再参加', `${name} ${peerId.slice(0, 4)}`);
      return;
    }

    const seat = this.freeSeat();
    if (seat === null) {
      this.sendTo(peerId, { type: MSG.REJECTED, reason: '卓が満席です。' });
      return;
    }

    const playerId = `p-${sessionId}`;
    this.peers.set(peerId, { sessionId, playerId, name });
    this.seatsBySession.set(sessionId, playerId);
    this.sendTo(peerId, {
      type: MSG.WELCOME,
      playerId,
      resumed: false,
      hostIsPlaying: this.options.hostPlays,
    });
    this.apply({
      type: 'sit',
      playerId,
      name,
      seat,
      chips: this.options.startingChips,
    });
    diagLog('新規参加', `${name} 席${seat}`);
  }

  private onPeerLeave(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer === undefined) return;
    this.peers.delete(peerId);
    // 席は残したまま離席にする。再接続すれば同じ席に戻れる。
    // 手番が回ってきたらエンジンが自動フォールドするので進行は止まらない。
    this.apply({ type: 'setAway', playerId: peer.playerId, away: true });
    diagLog('guest切断', `${peer.name} ${peerId.slice(0, 4)}`);
  }

  private freeSeat(): number | null {
    const taken = new Set(this.state.players.map((p) => p.seat));
    for (let seat = 0; seat < this.state.seatCount; seat++) {
      if (!taken.has(seat)) return seat;
    }
    return null;
  }

  private apply(action: Action): void {
    if (this.options.paced && (isDecision(action) || action.type === 'startHand') && Date.now() < this.runtime.snapshot().readyAt) return;
    const clock = this.runtime.snapshot().clock;
    if (isDecision(action) && action.type !== 'timeout' && clock?.deadline != null && Date.now() >= clock.deadline) {
      this.apply({ type: 'timeout', playerId: clock.playerId });
      return;
    }
    if (validate(this.state, action) !== null) return;
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.runtime.advance(this.state, next, action);
    this.state = next;
    this.cached = this.compute();
    for (const listener of this.listeners) listener(this.cached);
    this.broadcastState();
  }

  /** 各 guest にその人向けの状態を送る。全員に同じものは送らない。 */
  private broadcastState(): void {
    for (const [peerId, peer] of this.peers) {
      this.sendTo(peerId, { type: MSG.STATE, state: project(this.state, peer.playerId), runtime: this.runtime.snapshot(), serverNow: Date.now() });
    }
  }

  private sendTo(peerId: string | undefined, message: HostMessage): void {
    this.link.send(message, peerId);
  }

  private compute(): TableSnapshot {
    // 席に着いていない host は観戦者として見る。誰のホールカードも映らない。
    const viewerId = this.options.hostPlays ? this.hostPlayerId : null;
    return { state: project(this.state, viewerId), viewerId, status: 'connected', note: this.autoDealNote, runtime: this.runtime.snapshot() };
  }

  cancelNextHand() {
    this.runtime.cancelNextHand();
    this.cached = this.compute();
    for (const listener of this.listeners) listener(this.cached);
    this.broadcastState();
  }
}
