import {
  type Action,
  type HandRecord,
  type NonceEntry,
  type VisibleState,
  createGame,
  project,
  randomHex,
} from '@wildcard/engine';
import { NET_CONFIG } from '../net/config.js';
import { diagLog } from '../net/diag.js';
import type { PeerLink } from '../net/peerLink.js';
import { MSG, PROTO_VERSION, parseHostMessage } from '../net/protocol.js';
import type { ConnectionStatus, TableSnapshot, Transport } from './types.js';
import { receiveRuntime, type TableRuntimeSnapshot } from './tableRuntime.js';

/** 記録は commit → seed → 公開 の順に埋まっていく。 */
interface MutableRecord {
  readonly handNo: number;
  readonly commit: string;
  nonces: NonceEntry[];
  seedHex: string | null;
  aborted: boolean;
  secret: string | null;
}

export interface GuestTransportOptions {
  readonly link: PeerLink;
  readonly roomCode: string;
  readonly name: string;
  /** 端末ごとに固定の識別子。再接続で同じ席に戻るために使う。 */
  readonly sessionId: string;
  readonly seatCount?: number;
}

/**
 * guest 側の Transport。
 *
 * エンジンは回さない。やりたいことを host に送り、返ってきた
 * **自分向けに伏せられた状態** をそのまま UI に渡すだけ。
 * 他人のホールカードはそもそも手元に届かない。
 */
export class GuestTransport implements Transport {
  private cached: TableSnapshot;
  private readonly listeners = new Set<(snapshot: TableSnapshot) => void>();

  private readonly link: PeerLink;
  private readonly options: GuestTransportOptions;
  private playerId: string | null = null;
  private status: ConnectionStatus = 'connecting';
  private note: string | null = null;
  private lastHeard = 0;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private readonly emptyState: VisibleState;
  private runtime: TableRuntimeSnapshot = { handId: 0, handStartedAt: null, clock: null, events: [], readyAt: 0, nextHandAt: null, potChips: [], bets: [] };
  /** 配牌の記録。host が秘密を公開したら、これで全ハンドを検証できる。 */
  private readonly fairLog = new Map<number, MutableRecord>();

  constructor(options: GuestTransportOptions) {
    this.options = options;
    this.link = options.link;
    // host から最初の状態が届くまでの置き場。空の卓を描いておく。
    this.emptyState = project(createGame({ seatCount: options.seatCount ?? 10 }), null);
    this.cached = this.compute(this.emptyState);

    this.link.onMessage((message) => this.onMessage(message));
    this.link.onPeerJoin((peerId) => {
      diagLog('host接続', peerId.slice(0, 4));
      this.sendHello();
    });
    this.link.onPeerLeave(() => this.setStatus('disconnected', 'host との接続が切れました。再接続しています…'));
  }

  // ---- Transport ----

  snapshot(): TableSnapshot {
    return this.cached;
  }

  subscribe(listener: (snapshot: TableSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 自分の操作を host に送る。ここでは状態を変えない。
   * 変化は host が返してくる次のスナップショットで反映される
   * （勝手に先に進めると host の判定と食い違うため）。
   */
  dispatch(action: Action): void {
    if (this.playerId === null) return;
    this.link.send({ type: MSG.ACTION, action, turnId: this.runtime.clock?.id ?? null });
  }

  // ---- guest 固有 ----

  async start(): Promise<void> {
    await this.link.join(this.options.roomCode);
    this.silenceTimer = setInterval(() => this.checkSilence(), 2000);
  }

  leave(): void {
    if (this.silenceTimer !== null) clearInterval(this.silenceTimer);
    this.silenceTimer = null;
    this.link.leave();
  }

  // ---- 内部 ----

  private sendHello(): void {
    this.link.send({
      type: MSG.HELLO,
      proto: PROTO_VERSION,
      sessionId: this.options.sessionId,
      name: this.options.name,
    });
  }

  private onMessage(raw: unknown): void {
    const message = parseHostMessage(raw);
    if (message === null) return;
    this.lastHeard = Date.now();

    switch (message.type) {
      case MSG.WELCOME:
        this.playerId = message.playerId;
        this.setStatus('connected', message.resumed ? '席に戻りました。' : null);
        break;

      case MSG.REJECTED:
        this.setStatus('rejected', message.reason);
        this.link.leave();
        break;

      case MSG.STATE:
        this.status = 'connected';
        this.note = null;
        this.runtime = receiveRuntime(message.runtime, message.serverNow);
        this.publish(message.state);
        break;

      case MSG.CLOSED:
        this.setStatus('closed', 'host が部屋を閉じました。');
        this.link.leave();
        break;

      case MSG.DEAL_COMMIT:
        this.onDealCommit(message.handNo, message.commit);
        break;

      case MSG.DEAL_SEED: {
        const record = this.fairLog.get(message.handNo);
        if (record) {
          record.nonces = [...message.nonces];
          record.seedHex = message.seedHex;
        }
        break;
      }

      case MSG.DEAL_ABORT: {
        const record = this.fairLog.get(message.handNo);
        if (record) {
          record.nonces = [...message.nonces];
          record.aborted = true;
        }
        break;
      }

      case MSG.DEAL_REVEAL:
        for (const { handNo, secret } of message.secrets) {
          const record = this.fairLog.get(handNo);
          if (record) record.secret = secret;
        }
        this.publish(this.cached.state);
        break;
    }
  }

  /**
   * 配る前のコミットを受け取り、自分の乱数を返す。
   *
   * host はこの時点で秘密を固定しているので、こちらの乱数を見てから
   * 秘密を選び直すことはできない。だから seed を狙えない。
   */
  private onDealCommit(handNo: number, commit: string): void {
    if (this.fairLog.has(handNo)) return; // 同じハンドのコミットは一度だけ
    this.fairLog.set(handNo, {
      handNo,
      commit,
      nonces: [],
      seedHex: null,
      aborted: false,
      secret: null,
    });
    this.link.send({ type: MSG.DEAL_NONCE, handNo, nonce: randomHex() });
  }

  /** 検証用の記録。 */
  fairnessRecords(): HandRecord[] {
    return [...this.fairLog.values()]
      .sort((a, b) => a.handNo - b.handNo)
      .map((r) => ({
        handNo: r.handNo,
        commit: r.commit,
        nonces: r.nonces,
        seedHex: r.seedHex,
        aborted: r.aborted,
        secret: r.secret,
      }));
  }

  /** 自分の playerId。検証で「自分の乱数が使われたか」を見るのに要る。 */
  selfPlayerId(): string | null {
    return this.playerId;
  }

  /**
   * host からの無音を切断とみなす。
   * DataChannel は信頼配送なので、定期配信の周期 + 余裕を超えた無音は回線断。
   */
  private checkSilence(): void {
    if (this.status !== 'connected' || this.lastHeard === 0) return;
    if (Date.now() - this.lastHeard > NET_CONFIG.hostSilenceTimeoutMs) {
      this.setStatus('disconnected', 'host からの応答が途絶えました。再接続しています…');
    }
  }

  private setStatus(status: ConnectionStatus, note: string | null): void {
    this.status = status;
    this.note = note;
    this.publish(this.cached.state);
  }

  private publish(state: VisibleState): void {
    this.cached = this.compute(state);
    for (const listener of this.listeners) listener(this.cached);
  }

  private compute(state: VisibleState): TableSnapshot {
    return { state, viewerId: this.playerId, status: this.status, note: this.note, runtime: this.runtime };
  }
}
