import { NET_CONFIG } from './config.js';
import { diagLog } from './diag.js';
import { TrackerSignal, type SessionDescriptionLike } from './signal.js';

/**
 * 端末どうしの接続層。
 *
 * Wildcard の `Transport`（UI ↔ エンジン）とは別の層なので名前を分けている。
 * こちらは「どの端末とどう繋ぐか」だけを扱い、ポーカーのことは何も知らない。
 *
 * トポロジは WebRTC のレベルでスター型に強制する:
 * - peer_id の先頭に役割を埋め込む（WCH-*=host / WCG-*=guest）
 * - guest は host の offer にしか answer しない（guest どうしは繋がない）
 * - host は guest の offer にのみ answer する
 *
 * 参加を速くするため host と guest の両方が offer を announce する（双方向 offer）。
 * 同じ相手と両方向で確立してしまった場合は「offer を出した側の peer_id が
 * 小さい方を残す」決定的ルールで片方を閉じる（両端で同じ結論になる）。
 */

export type PeerRole = 'host' | 'guest';

export interface PeerLink {
  readonly selfId: string;
  join(roomId: string): Promise<void>;
  leave(): void;
  /** peerId を省略すると全ピアへ送る。 */
  send(message: unknown, peerId?: string): void;
  onMessage(handler: (message: unknown, peerId: string) => void): void;
  onPeerJoin(handler: (peerId: string) => void): void;
  onPeerLeave(handler: (peerId: string) => void): void;
  /** 自分の ICE 候補が mDNS で隠されているか。null は未収集。 */
  usesMdnsCandidates(): boolean | null;
  /** LAN 内の host 候補を出せているか。旧 Safari はマイク許可なしで false になる。 */
  hasHostCandidates(): boolean | null;
  /** 旧端末互換モード。下の enableLegacyCompat を参照。 */
  enableLegacyCompat(): Promise<void>;
}

const ROLE_PREFIX: Record<PeerRole, string> = { host: 'WCH-', guest: 'WCG-' };

/** DataChannel 1 通の上限。これを超える受信は捨てる。 */
const MAX_MESSAGE_BYTES = 262144;

interface Connection {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  /** この接続で offer を出した側の peer_id。重複解決の決定に使う。 */
  readonly offererId: string;
}

interface PooledEntry {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  readonly sdp: string;
  readonly createdAt: number;
}

interface PendingAnswer {
  readonly pc: RTCPeerConnection;
  readonly createdAt: number;
  gotChannel: boolean;
}

export function createPeerLink({ role }: { readonly role: PeerRole }): PeerLink {
  const prefix = ROLE_PREFIX[role];
  const selfId = prefix + randomId(16);
  const remotePrefix = role === 'host' ? ROLE_PREFIX.guest : ROLE_PREFIX.host;

  const messageHandlers: ((message: unknown, peerId: string) => void)[] = [];
  const joinHandlers: ((peerId: string) => void)[] = [];
  const leaveHandlers: ((peerId: string) => void)[] = [];

  let signal: TrackerSignal | null = null;
  let active = false;

  /** offerId -> 接続待ち受け枠 */
  const offerPool = new Map<string, PooledEntry>();
  /** 自分が answer を返して確立待ちの接続 */
  const pendingAnswers = new Set<PendingAnswer>();
  const peers = new Map<string, Connection>();
  /** remotePeerId -> 最後に answer を返した時刻。連打抑制。 */
  const lastAnsweredAt = new Map<string, number>();

  let sawMdnsCandidates: boolean | null = null;
  let sawHostCandidates: boolean | null = null;

  const newPeerConnection = () =>
    new RTCPeerConnection({ iceServers: [...NET_CONFIG.iceServers] });

  /** 収集できた ICE 候補の種別を診断ログに残す。mDNS 混入や TURN の生死が分かる。 */
  function logCandidates(pc: RTCPeerConnection, label: string): void {
    const sdp = pc.localDescription?.sdp ?? '';
    const lines = sdp.split('\n').filter((line) => line.startsWith('a=candidate'));
    const count = (type: string) => lines.filter((line) => line.includes(`typ ${type}`)).length;
    const mdns = lines.filter((line) => line.includes('.local')).length;
    sawMdnsCandidates = mdns > 0;
    sawHostCandidates = count('host') > 0;
    diagLog(
      '候補',
      `${label} host=${count('host')}(mDNS ${mdns}) srflx=${count('srflx')} relay=${count('relay')}`,
    );
  }

  /**
   * 相手が確定した接続にイベントを配線する。
   * Connection はここで1つだけ作る。open 済みで届いた場合と open イベント経由の
   * 両方から registerPeer が呼ばれても、同一接続と判定できるようにするため。
   */
  function wireConnection(
    pc: RTCPeerConnection,
    channel: RTCDataChannel,
    remoteId: string,
    offererId: string,
  ): void {
    const conn: Connection = { pc, channel, offererId };

    const onOpen = () => registerPeer(remoteId, conn);
    if (channel.readyState === 'open') onOpen();
    else channel.addEventListener('open', onOpen);

    channel.addEventListener('close', () => unregisterPeer(remoteId, channel));

    channel.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_BYTES) return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const handler of messageHandlers) handler(message, remoteId);
    });

    /**
     * 相手プロセスの突然死（タブ強制終了等）では close が飛んでこないため、
     * ICE の disconnected を猶予付きで切断とみなす。復帰したら取り消す。
     */
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    pc.addEventListener('iceconnectionstatechange', () => {
      const state = pc.iceConnectionState;
      diagLog('ICE', `${remoteId.slice(0, 4)} ${state}`);

      if (state === 'disconnected') {
        disconnectTimer ??= setTimeout(
          () => unregisterPeer(remoteId, channel),
          NET_CONFIG.signaling.iceDisconnectGraceMs,
        );
      } else if (state === 'connected' || state === 'completed') {
        if (disconnectTimer !== null) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
      } else if (state === 'failed' || state === 'closed') {
        unregisterPeer(remoteId, channel);
      }
    });
  }

  function registerPeer(remoteId: string, conn: Connection): void {
    if (!active) {
      conn.pc.close();
      return;
    }

    const existing = peers.get(remoteId);
    if (existing !== undefined) {
      if (existing.channel === conn.channel) return; // 同一接続の再登録

      // 双方向 offer で二重に確立した場合の決定的な重複解決。
      // 両端が同じ結論に達するよう、offer を出した側の id だけで決める。
      const keepNew = conn.offererId < existing.offererId;
      const winner = keepNew ? conn : existing;
      const loser = keepNew ? existing : conn;
      peers.set(remoteId, winner);
      loser.channel.close();
      loser.pc.close();
      return; // onPeerJoin は既に発火済み
    }

    peers.set(remoteId, conn);
    diagLog('ピア接続', remoteId.slice(0, 4));
    for (const handler of joinHandlers) handler(remoteId);
  }

  function unregisterPeer(remoteId: string, channel: RTCDataChannel): void {
    const current = peers.get(remoteId);
    if (current === undefined || current.channel !== channel) return; // 重複解決で閉じた側
    peers.delete(remoteId);
    current.pc.close();
    diagLog('ピア切断', remoteId.slice(0, 4));
    for (const handler of leaveHandlers) handler(remoteId);
  }

  // ---- offer プール（announce に載せる接続待ち受け枠） ----

  async function createPoolOffer(): Promise<void> {
    const pc = newPeerConnection();
    try {
      const channel = pc.createDataChannel('data');
      const offerId = randomId(20);
      await pc.setLocalDescription(await pc.createOffer());
      await waitIceGathering(pc);
      logCandidates(pc, 'offer');
      offerPool.set(offerId, {
        pc,
        channel,
        sdp: pc.localDescription?.sdp ?? '',
        createdAt: Date.now(),
      });
    } catch (error) {
      diagLog('offer作成エラー', describe(error));
      pc.close();
      throw error;
    }
  }

  async function getOffers() {
    if (!active) return [];
    const now = Date.now();

    // 古い offer は ICE 候補が失効しうるので作り直す。
    for (const [offerId, entry] of offerPool) {
      if (now - entry.createdAt > NET_CONFIG.signaling.offerTtlMs) {
        offerPool.delete(offerId);
        entry.pc.close();
      }
    }
    // 確立に至らなかった answer 側の接続も掃除する。
    for (const pending of [...pendingAnswers]) {
      if (!pending.gotChannel && now - pending.createdAt > NET_CONFIG.signaling.pendingAnswerTtlMs) {
        pendingAnswers.delete(pending);
        pending.pc.close();
      }
    }

    while (offerPool.size < NET_CONFIG.signaling.offerPool) {
      await createPoolOffer();
    }
    return [...offerPool.entries()].map(([offerId, entry]) => ({ offerId, sdp: entry.sdp }));
  }

  // ---- シグナル処理 ----

  async function handleRemoteOffer(
    offer: SessionDescriptionLike,
    fromPeerId: string,
    respond: (answer: SessionDescriptionLike) => void,
  ): Promise<void> {
    if (!active) return;
    if (!fromPeerId.startsWith(remotePrefix)) return; // スター型: 想定した役割以外は無視

    const existing = peers.get(fromPeerId);
    if (existing !== undefined && existing.channel.readyState === 'open') return;

    // 同じ相手の複数 offer に片っ端から answer すると並列接続が乱立するため、
    // 確立待ちの間は少し空ける。失敗しても次の offer で再試行される。
    const now = Date.now();
    const last = lastAnsweredAt.get(fromPeerId);
    if (last !== undefined && now - last < NET_CONFIG.signaling.answerThrottleMs) return;
    lastAnsweredAt.set(fromPeerId, now);

    const pc = newPeerConnection();
    const pending: PendingAnswer = { pc, createdAt: now, gotChannel: false };
    pendingAnswers.add(pending);

    pc.addEventListener('datachannel', (event: RTCDataChannelEvent) => {
      pending.gotChannel = true;
      pendingAnswers.delete(pending);
      wireConnection(pc, event.channel, fromPeerId, fromPeerId);
    });

    try {
      await pc.setRemoteDescription(toSessionDescription(offer));
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIceGathering(pc);
      logCandidates(pc, 'answer');
      const local = pc.localDescription;
      if (local) respond({ type: local.type, sdp: local.sdp });
    } catch (error) {
      diagLog('offer処理エラー', describe(error));
      pendingAnswers.delete(pending);
      pc.close();
    }
  }

  async function handleRemoteAnswer(
    offerId: string,
    answer: SessionDescriptionLike,
    fromPeerId: string,
  ): Promise<void> {
    if (!active) return;
    if (!fromPeerId.startsWith(remotePrefix)) return;

    const entry = offerPool.get(offerId);
    if (entry === undefined || entry.pc.signalingState !== 'have-local-offer') return;
    offerPool.delete(offerId); // この offer は消費された

    wireConnection(entry.pc, entry.channel, fromPeerId, selfId);
    try {
      await entry.pc.setRemoteDescription(toSessionDescription(answer));
    } catch (error) {
      diagLog('answer適用エラー', describe(error));
      entry.pc.close();
      return;
    }
    signal?.requestAnnounce(); // プールを補充して次の参加に備える
  }

  /**
   * 旧端末互換モード。
   *
   * マイク使用許可を一度取ると Chrome 等が ICE 候補に実 IP を含めるようになり、
   * mDNS の .local 名を解決できない旧 WebRTC（iOS 12 等）とも同一 LAN で直結できる。
   * 音声は一切使わず、取得したトラックは即座に止める。
   */
  async function enableLegacyCompat(): Promise<void> {
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      diagLog('互換モード失敗', 'mediaDevices API が無効（プライベートモード等）');
      throw new Error('mediaDevices unavailable');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } catch (error) {
      diagLog('互換モード失敗', describe(error));
      throw error;
    }
    diagLog('互換モード', 'マイク許可OK（実IP候補が有効）');
    // 既存の待ち受け offer は mDNS 候補のままなので作り直す。
    for (const entry of offerPool.values()) entry.pc.close();
    offerPool.clear();
    signal?.requestAnnounce();
  }

  return {
    selfId,
    enableLegacyCompat,
    usesMdnsCandidates: () => sawMdnsCandidates,
    hasHostCandidates: () => sawHostCandidates,

    async join(roomId: string): Promise<void> {
      active = true;
      diagLog('参加開始', `role=${role}`);
      // 部屋のトピックをハッシュ化してトラッカーの info_hash（20文字）にする。
      // ルームコードそのものはトラッカーに出さない。
      const infoHash = (await sha1Hex(`${NET_CONFIG.appId}/${roomId}`)).slice(0, 20);
      signal = new TrackerSignal({
        urls: NET_CONFIG.signaling.trackerUrls,
        infoHash,
        peerId: selfId,
        onRemoteOffer: (offer, fromPeerId, respond) => {
          void handleRemoteOffer(offer, fromPeerId, respond);
        },
        onRemoteAnswer: (offerId, answer, fromPeerId) => {
          void handleRemoteAnswer(offerId, answer, fromPeerId);
        },
      });
      signal.start(getOffers);
    },

    leave(): void {
      active = false;
      signal?.stop();
      signal = null;
      for (const entry of offerPool.values()) entry.pc.close();
      offerPool.clear();
      for (const pending of pendingAnswers) pending.pc.close();
      pendingAnswers.clear();
      for (const conn of peers.values()) conn.pc.close();
      peers.clear();
      lastAnsweredAt.clear();
    },

    send(message: unknown, peerId?: string): void {
      const text = JSON.stringify(message);
      const targets =
        peerId !== undefined ? [peers.get(peerId)] : [...peers.values()];
      for (const conn of targets) {
        if (conn === undefined || conn.channel.readyState !== 'open') continue;
        try {
          conn.channel.send(text);
        } catch {
          // 切断直後の送信失敗は無視する。状態は次のスナップショットで回復する。
        }
      }
    },

    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onPeerJoin(handler) {
      joinHandlers.push(handler);
    },
    onPeerLeave(handler) {
      leaveHandlers.push(handler);
    },
  };
}

/**
 * ICE 候補の収集完了を待つ。
 * トラッカー経由では候補を後送りできないため SDP に同梱する必要がある。
 * 遅い環境で待ち続けないよう上限時間で打ち切る。
 */
function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, NET_CONFIG.signaling.iceGatherTimeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * 旧 WebKit（iOS 12 等）は setRemoteDescription に RTCSessionDescription の
 * インスタンスを要求するため、素のオブジェクトを包んで渡す。
 */
function toSessionDescription(description: SessionDescriptionLike): RTCSessionDescriptionInit {
  const init = { type: description.type as RTCSdpType, sdp: description.sdp };
  return typeof RTCSessionDescription === 'function'
    ? (new RTCSessionDescription(init) as unknown as RTCSessionDescriptionInit)
    : init;
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function randomId(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name} ${error.message}` : String(error);
}
