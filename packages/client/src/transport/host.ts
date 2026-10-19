import {
  type Action,
  type CreateGameOptions,
  type GameState,
  createGame,
  project,
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

export interface HostTransportOptions extends CreateGameOptions {
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
}

interface PeerInfo {
  readonly sessionId: string;
  readonly playerId: string;
  name: string;
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

  constructor(options: HostTransportOptions) {
    const { link, roomCode, hostName, hostPlays, startingChips, ...gameOptions } = options;
    this.options = options;
    this.link = link;
    this.hostPlayerId = `host-${roomCode}`;

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
    await this.link.join(this.options.roomCode);
    // 無音が続くと guest 側が切断と判断するので、変化がなくても定期的に配る。
    this.heartbeat = setInterval(() => this.broadcastState(), NET_CONFIG.hostHeartbeatMs);
  }

  /** 部屋を閉じる。単なる切断と区別して guest に伝える。 */
  close(): void {
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
    if (peer === undefined) return; // hello 前のアクションは無視

    // 形が正しいだけでは足りない。その席の持ち主かどうかを必ず確かめる。
    // ここを抜かすと「他人の名前で降りる」ができてしまう。
    if (!authorizeAction(message.action, peer.playerId)) {
      diagLog('認可拒否', `${peerId.slice(0, 4)} ${message.action.type}`);
      return;
    }

    this.apply(message.action);
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
    if (validate(this.state, action) !== null) return;
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.cached = this.compute();
    for (const listener of this.listeners) listener(this.cached);
    this.broadcastState();
  }

  /** 各 guest にその人向けの状態を送る。全員に同じものは送らない。 */
  private broadcastState(): void {
    for (const [peerId, peer] of this.peers) {
      this.sendTo(peerId, { type: MSG.STATE, state: project(this.state, peer.playerId) });
    }
  }

  private sendTo(peerId: string | undefined, message: HostMessage): void {
    this.link.send(message, peerId);
  }

  private compute(): TableSnapshot {
    // 席に着いていない host は観戦者として見る。誰のホールカードも映らない。
    const viewerId = this.options.hostPlays ? this.hostPlayerId : null;
    return { state: project(this.state, viewerId), viewerId, status: 'connected', note: null };
  }
}
