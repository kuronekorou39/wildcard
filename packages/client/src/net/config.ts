/**
 * 通信まわりの調整値。
 *
 * 値と方針は hayabuzz（同じ作者のサーバレスP2P早押しクイズ）の実装から
 * 持ち込んでいる。実運用で削れた数字なので、理由なく動かさないこと。
 */
export const NET_CONFIG = {
  /** 部屋トピックの名前空間。info_hash の材料になる。 */
  appId: 'wildcard-v1',

  /** 参加要求を出してから welcome が返るまでの待ち時間。 */
  joinTimeoutMs: 15000,

  /**
   * host からの応答が途絶えたと判断するまでの時間。
   * DataChannel は信頼配送なので、定期同期の周期 + 余裕を超えた無音は回線断とみなせる。
   */
  hostSilenceTimeoutMs: 15000,

  /** host が定期的に状態を配る周期。無音判定の基準にもなる。 */
  hostHeartbeatMs: 5000,

  /** 卓の最大人数。エンジンの席数とは別で、部屋に入れる人数の上限。 */
  maxPeers: 12,

  /** host が離脱してから同じ部屋に復帰できる時間。 */
  hostRoomTtlMs: 6 * 60 * 60 * 1000,

  signaling: {
    /**
     * WebTorrent トラッカー。本来は BitTorrent のピア発見用だが、WebSocket 版は
     * announce に WebRTC の offer を相乗りさせると同じ info_hash の相手へ転送してくれる。
     * ここを通るのは接続情報（SDP）だけで、ゲームのデータは一切通らない。
     */
    trackerUrls: [
      'wss://tracker.webtorrent.dev',
      'wss://tracker.openwebtorrent.com',
      'wss://open.ftorrent.com',
    ],
    /** 定期 announce。新しい参加者が offer を受け取れる周期。 */
    announceIntervalMs: 10000,
    reconnectBaseMs: 2000,
    reconnectMaxMs: 30000,
    /** トラッカーに希望する offer 配布先ピア数。 */
    numwant: 8,
    /** 待ち受け offer の常備数。 */
    offerPool: 3,
    /** 古い offer を作り直すまでの時間。ICE 候補の失効対策。 */
    offerTtlMs: 120000,
    /** ICE 候補収集の打ち切り時間。遅い環境で待ち続けないため。 */
    iceGatherTimeoutMs: 1600,
    /** 複数トラッカー経由で届く同じシグナルを捨てる時間窓。 */
    dedupeWindowMs: 4000,
    /** 同じ相手の offer に answer を返す間隔の下限。並列接続の乱立を防ぐ。 */
    answerThrottleMs: 5000,
    /** answer を返したが確立しなかった接続を片付けるまでの時間。 */
    pendingAnswerTtlMs: 30000,
    /** ICE が disconnected になってから切断とみなすまでの猶予。 */
    iceDisconnectGraceMs: 5000,
  },

  /**
   * 経路確立（ICE）の設定。
   *
   * STUN を複数置いて経路発見を安定させ、直結できない回線（対称NAT・キャリア回線・
   * iCloud プライベートリレー等）のために TURN 中継をフォールバックに置く。
   * 下の TURN はコミュニティ提供のベストエフォートなので、安定運用したいなら
   * 自前の TURN に差し替えること。
   */
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ] satisfies RTCIceServer[],
} as const;
