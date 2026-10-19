import { NET_CONFIG } from './config.js';
import { diagLog } from './diag.js';

/**
 * WebTorrent トラッカーの WebSocket プロトコルを話すシグナリングクライアント。
 *
 * トラッカーは本来 BitTorrent のピア発見用だが、WebSocket 版のプロトコルは
 * announce メッセージに WebRTC の offer を相乗りさせると、同じ info_hash に
 * announce している他のピアへ転送してくれる（answer も同様）。
 * これを「接続情報の掲示板」として使う。
 *
 * **転送されるのは SDP テキストだけで、接続確立後のゲームデータは一切通らない。**
 * トラッカーが要るのは参加の瞬間だけで、途中で落ちても対局は続く。
 *
 * メッセージ形式（すべて JSON テキスト）:
 *   自分 → トラッカー: { action:'announce', info_hash, peer_id, numwant,
 *                        offers:[{ offer_id, offer:{type:'offer', sdp} }] }
 *   トラッカー → 相手:  { action:'announce', info_hash, peer_id(=送信元), offer_id, offer }
 *   相手 → トラッカー:  { action:'announce', info_hash, peer_id, to_peer_id, offer_id,
 *                        answer:{type:'answer', sdp} }
 */

export interface PooledOffer {
  readonly offerId: string;
  readonly sdp: string;
}

export interface SessionDescriptionLike {
  readonly type: string;
  readonly sdp: string;
}

export interface TrackerSignalOptions {
  readonly urls: readonly string[];
  readonly infoHash: string;
  readonly peerId: string;
  readonly onRemoteOffer: (
    offer: SessionDescriptionLike,
    fromPeerId: string,
    respond: (answer: SessionDescriptionLike) => void,
  ) => void;
  readonly onRemoteAnswer: (
    offerId: string,
    answer: SessionDescriptionLike,
    fromPeerId: string,
  ) => void;
}

export class TrackerSignal {
  private readonly options: TrackerSignalOptions;
  private getOffers: (() => Promise<readonly PooledOffer[]>) | null = null;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly retryDelays = new Map<string, number>();
  /** 同じシグナルが複数トラッカー経由で届くので、短い時間窓で重複排除する。 */
  private readonly handledSignals = new Map<string, number>();
  private announceQueued = false;
  private active = false;

  constructor(options: TrackerSignalOptions) {
    this.options = options;
  }

  start(getOffers: () => Promise<readonly PooledOffer[]>): void {
    this.getOffers = getOffers;
    this.active = true;
    for (const url of this.options.urls) this.connect(url);
  }

  stop(): void {
    this.active = false;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    for (const socket of this.sockets.values()) {
      socket.onclose = null;
      socket.close();
    }
    this.sockets.clear();
  }

  /** offer プールが変化したときなど、次の周期を待たず全トラッカーへ再 announce する。 */
  requestAnnounce(): void {
    if (!this.active || this.announceQueued) return;
    this.announceQueued = true;
    setTimeout(() => {
      this.announceQueued = false;
      for (const url of this.sockets.keys()) void this.announce(url);
    }, 300); // 連続した呼び出しをまとめるデバウンス
  }

  private connect(url: string): void {
    if (!this.active) return;
    const shortHost = url.replace('wss://', '').split('/')[0] ?? url;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      diagLog('トラッカー接続不可', `${shortHost} ${describe(error)}`);
      this.scheduleReconnect(url);
      return;
    }

    this.sockets.set(url, socket);

    socket.onopen = () => {
      diagLog('トラッカー接続', shortHost);
      this.retryDelays.delete(url);
      void this.announce(url);
      this.timers.set(
        url,
        setInterval(() => void this.announce(url), NET_CONFIG.signaling.announceIntervalMs),
      );
    };

    socket.onmessage = (event: MessageEvent) => this.handleMessage(url, event.data);

    socket.onclose = () => {
      diagLog('トラッカー切断', shortHost);
      const timer = this.timers.get(url);
      if (timer !== undefined) clearInterval(timer);
      this.timers.delete(url);
      this.sockets.delete(url);
      this.scheduleReconnect(url);
    };

    // 後始末は onclose 側でまとめて行う。
    socket.onerror = () => {};
  }

  private scheduleReconnect(url: string): void {
    if (!this.active) return;
    const delay = this.retryDelays.get(url) ?? NET_CONFIG.signaling.reconnectBaseMs;
    this.retryDelays.set(url, Math.min(delay * 2, NET_CONFIG.signaling.reconnectMaxMs));
    setTimeout(() => this.connect(url), delay);
  }

  private async announce(url: string): Promise<void> {
    const socket = this.sockets.get(url);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const offers = (await this.getOffers?.()) ?? [];
    this.send(url, {
      numwant: NET_CONFIG.signaling.numwant,
      offers: offers.map((offer) => ({
        offer_id: offer.offerId,
        offer: { type: 'offer', sdp: offer.sdp },
      })),
    });
  }

  private send(url: string, payload: Record<string, unknown>): void {
    const socket = this.sockets.get(url);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        action: 'announce',
        info_hash: this.options.infoHash,
        peer_id: this.options.peerId,
        ...payload,
      }),
    );
  }

  private handleMessage(url: string, raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 65536) return;

    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      data = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const failure = data['failure reason'];
    if (typeof failure === 'string') {
      diagLog('トラッカー拒否', failure);
      return;
    }

    if (data['info_hash'] !== undefined && data['info_hash'] !== this.options.infoHash) return;
    const fromPeerId = data['peer_id'];
    if (typeof fromPeerId !== 'string') return;
    if (fromPeerId === this.options.peerId) return; // 自分の announce の跳ね返り

    const offer = asDescription(data['offer']);
    const answer = asDescription(data['answer']);
    const offerId = data['offer_id'];
    if ((offer === null && answer === null) || typeof offerId !== 'string') {
      return; // 通常の announce 応答（interval 等）は無視してよい
    }

    const key = `${offer !== null ? 'o' : 'a'}:${offerId}:${fromPeerId}`;
    const now = Date.now();
    const last = this.handledSignals.get(key);
    if (last !== undefined && now - last < NET_CONFIG.signaling.dedupeWindowMs) return;
    this.handledSignals.set(key, now);
    for (const [seen, at] of this.handledSignals) {
      if (now - at > NET_CONFIG.signaling.dedupeWindowMs * 6) this.handledSignals.delete(seen);
    }

    if (offer !== null) {
      diagLog('offer受信', fromPeerId.slice(0, 4));
      // answer は offer が届いたのと同じトラッカー経由で返す。
      const respond = (description: SessionDescriptionLike) => {
        diagLog('answer送信', fromPeerId.slice(0, 4));
        this.send(url, {
          to_peer_id: fromPeerId,
          offer_id: offerId,
          answer: { type: 'answer', sdp: description.sdp },
        });
      };
      this.options.onRemoteOffer(offer, fromPeerId, respond);
    } else if (answer !== null) {
      diagLog('answer受信', fromPeerId.slice(0, 4));
      this.options.onRemoteAnswer(offerId, answer, fromPeerId);
    }
  }
}

function asDescription(value: unknown): SessionDescriptionLike | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const sdp = record['sdp'];
  const type = record['type'];
  if (typeof sdp !== 'string' || typeof type !== 'string') return null;
  return { type, sdp };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
