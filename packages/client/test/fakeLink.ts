import type { PeerLink } from '../src/net/peerLink.js';

/**
 * テスト用の偽 PeerLink。
 *
 * WebRTC もトラッカーも使わず、同じプロセスの中でメッセージを渡すだけ。
 * これで HostTransport と GuestTransport の組み合わせを、通信を立てずに
 * 端から端まで試せる（届く順番や切断も手で起こせる）。
 */
export class FakeNetwork {
  readonly host: FakeLink;
  private readonly guests = new Map<string, FakeLink>();
  private nextPeerNumber = 0;

  constructor() {
    this.host = new FakeLink('WCH-HOST', (message, toPeerId) => {
      if (toPeerId === undefined) {
        for (const guest of this.guests.values()) guest.receive(message, 'WCH-HOST');
      } else {
        this.guests.get(toPeerId)?.receive(message, 'WCH-HOST');
      }
    });
  }

  /** guest 用のリンクを作る。まだ接続はしない。 */
  createGuest(): FakeLink {
    const peerId = `WCG-${++this.nextPeerNumber}`;
    const link = new FakeLink(peerId, (message) => this.host.receive(message, peerId));
    this.guests.set(peerId, link);
    return link;
  }

  /** 接続が確立したことにする。両端で onPeerJoin が起きる。 */
  connect(guest: FakeLink): void {
    this.host.firePeerJoin(guest.selfId);
    guest.firePeerJoin(this.host.selfId);
  }

  /** 切断する。両端で onPeerLeave が起きる。 */
  disconnect(guest: FakeLink): void {
    this.host.firePeerLeave(guest.selfId);
    guest.firePeerLeave(this.host.selfId);
  }

  /** guest を完全に取り除く（以後メッセージが届かない）。 */
  drop(guest: FakeLink): void {
    this.disconnect(guest);
    this.guests.delete(guest.selfId);
  }
}

export class FakeLink implements PeerLink {
  readonly selfId: string;
  /** この端末が送ったメッセージの記録。検証に使う。 */
  readonly sent: { readonly message: unknown; readonly peerId: string | undefined }[] = [];

  private readonly deliver: (message: unknown, peerId: string | undefined) => void;
  private readonly messageHandlers: ((message: unknown, peerId: string) => void)[] = [];
  private readonly joinHandlers: ((peerId: string) => void)[] = [];
  private readonly leaveHandlers: ((peerId: string) => void)[] = [];
  private open = true;

  constructor(
    selfId: string,
    deliver: (message: unknown, peerId: string | undefined) => void,
  ) {
    this.selfId = selfId;
    this.deliver = deliver;
  }

  async join(): Promise<void> {}

  leave(): void {
    this.open = false;
  }

  send(message: unknown, peerId?: string): void {
    if (!this.open) return;
    this.sent.push({ message, peerId });
    // 実際の経路を通るのと同じように、構造が JSON で往復できることも確かめる。
    this.deliver(JSON.parse(JSON.stringify(message)) as unknown, peerId);
  }

  onMessage(handler: (message: unknown, peerId: string) => void): void {
    this.messageHandlers.push(handler);
  }
  onPeerJoin(handler: (peerId: string) => void): void {
    this.joinHandlers.push(handler);
  }
  onPeerLeave(handler: (peerId: string) => void): void {
    this.leaveHandlers.push(handler);
  }

  usesMdnsCandidates(): boolean | null {
    return null;
  }
  hasHostCandidates(): boolean | null {
    return null;
  }
  async enableLegacyCompat(): Promise<void> {}

  // ---- テストから起こすイベント ----

  receive(message: unknown, fromPeerId: string): void {
    if (!this.open) return;
    for (const handler of this.messageHandlers) handler(message, fromPeerId);
  }

  firePeerJoin(peerId: string): void {
    for (const handler of this.joinHandlers) handler(peerId);
  }

  firePeerLeave(peerId: string): void {
    for (const handler of this.leaveHandlers) handler(peerId);
  }

  /** 悪意のある相手を模して、生のメッセージを直接送り込む。 */
  injectToPeer(message: unknown): void {
    this.deliver(message, undefined);
  }
}
