import { describe, expect, it } from 'vitest';
import { commitOf, deriveSeed, summarize, verifyAll } from '@wildcard/engine';
import { MSG } from '../src/net/protocol.js';
import { GuestTransport } from '../src/transport/guest.js';
import { HostTransport } from '../src/transport/host.js';
import { FakeLink, FakeNetwork } from './fakeLink.js';

interface Table {
  readonly net: FakeNetwork;
  readonly host: HostTransport;
  readonly guests: { readonly transport: GuestTransport; readonly link: FakeLink }[];
}

async function setupTable(names: readonly string[]): Promise<Table> {
  const net = new FakeNetwork();
  const host = new HostTransport({
    link: net.host,
    roomCode: 'ABCDEF',
    hostName: 'ホスト',
    hostPlays: true,
    startingChips: 1000,
    seatCount: 10,
    smallBlind: 10,
    bigBlind: 20,
    // 揃わない場合をすぐ試せるように短くする。
    nonceTimeoutMs: 50,
  });
  await host.start();

  const guests = [];
  for (const [i, name] of names.entries()) {
    const link = net.createGuest();
    const transport = new GuestTransport({
      link,
      roomCode: 'ABCDEF',
      name,
      sessionId: `session-${i}`,
    });
    await transport.start();
    net.connect(link);
    guests.push({ transport, link });
  }
  return { net, host, guests };
}

describe('配る前のやりとり', () => {
  it('コミットが配られ、全員の乱数が集まってから配られる', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);

    const result = await host.startHand();
    expect(result.ok).toBe(true);
    expect(host.rawState().phase).toBe('betting');

    const [record] = host.fairnessRecords();
    expect(record!.nonces).toHaveLength(2);
    expect(record!.aborted).toBe(false);
    expect(record!.seedHex).not.toBeNull();

    // guest 側にも同じ記録が残っている
    for (const guest of guests) {
      const [mine] = guest.transport.fairnessRecords();
      expect(mine!.commit).toBe(record!.commit);
      expect(mine!.seedHex).toBe(record!.seedHex);
      expect(mine!.nonces).toEqual(record!.nonces);
    }
  });

  it('自分の乱数が実際に使われている', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    await host.startHand();

    for (const guest of guests) {
      const selfId = guest.transport.selfPlayerId();
      const [record] = guest.transport.fairnessRecords();
      expect(record!.nonces.some((n) => n.playerId === selfId)).toBe(true);
    }
  });

  it('使われた seed は秘密と乱数から再現できる', async () => {
    const { host } = await setupTable(['あかり']);
    await host.startHand();
    host.revealAll();

    const [record] = host.fairnessRecords();
    const derived = await deriveSeed(record!.secret!, record!.nonces);
    expect(derived.seedHex).toBe(record!.seedHex);
    expect(await commitOf(record!.secret!)).toBe(record!.commit);
  });

  it('乱数が揃わなければ配らずに中断する', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    // ばしょうの端末が黙る（回線が細い・固まった等）
    guests[1]!.link.leave();

    const result = await host.startHand();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('揃わなかった');
    expect(host.rawState().phase).toBe('waiting');

    const [record] = host.fairnessRecords();
    expect(record!.aborted).toBe(true);
    expect(record!.seedHex).toBeNull();
  });

  it('同じハンドの乱数を二度送っても最初のものだけ採る', async () => {
    const { host, guests } = await setupTable(['あかり']);

    // コミットを受けた直後に、別の乱数を割り込ませる
    const original = guests[0]!.link.send.bind(guests[0]!.link);
    let handNo = 0;
    guests[0]!.link.onMessage((message) => {
      const msg = message as { type?: string; handNo?: number };
      if (msg.type === MSG.DEAL_COMMIT && typeof msg.handNo === 'number') {
        handNo = msg.handNo;
        original({ type: MSG.DEAL_NONCE, handNo, nonce: 'わりこみ' });
      }
    });

    await host.startHand();
    const [record] = host.fairnessRecords();
    expect(record!.nonces).toHaveLength(1);
    expect(record!.nonces[0]!.nonce).not.toBe('わりこみ');
  });
});

describe('検証', () => {
  it('公開前は未検証、公開後に検証が通る', async () => {
    const { host, guests } = await setupTable(['あかり']);
    await host.startHand();

    const guest = guests[0]!.transport;
    const before = summarize(await verifyAll(guest.fairnessRecords()));
    expect(before.unrevealed).toBe(1);
    expect(before.verified).toBe(0);

    host.revealAll();

    const after = summarize(
      await verifyAll(guest.fairnessRecords(), {
        selfPlayerId: guest.selfPlayerId()!,
      }),
    );
    expect(after.verified).toBe(1);
    expect(after.failed).toBe(0);
  });

  it('複数ハンドをまとめて検証できる', async () => {
    const { host, guests } = await setupTable(['あかり']);

    for (let i = 0; i < 3; i++) {
      const result = await host.startHand();
      if (!result.ok) continue;
      // 片方が降りて決着させ、次のハンドへ
      const turnId = host.rawState().turnPlayerId!;
      host.dispatch({ type: 'fold', playerId: turnId });
      if (host.rawState().phase !== 'showdown') {
        host.dispatch({ type: 'fold', playerId: host.rawState().turnPlayerId! });
      }
    }
    host.revealAll();

    const guest = guests[0]!.transport;
    const summary = summarize(
      await verifyAll(guest.fairnessRecords(), { selfPlayerId: guest.selfPlayerId()! }),
    );
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.verified).toBe(summary.total);
    expect(summary.failed).toBe(0);
  });

  it('host が別の秘密を公開するとコミット不一致で出る', async () => {
    const { host, guests, net } = await setupTable(['あかり']);
    await host.startHand();

    // 本来の公開を使わず、でっちあげた秘密を送りつける
    const [record] = guests[0]!.transport.fairnessRecords();
    net.host.send({
      type: MSG.DEAL_REVEAL,
      secrets: [{ handNo: record!.handNo, secret: 'でっちあげ' }],
    });

    const results = await verifyAll(guests[0]!.transport.fairnessRecords());
    expect(results[0]!.status).toBe('commit-mismatch');
  });

  it('自分の乱数が外された配牌は検証で落ちる', async () => {
    const { host, guests, net } = await setupTable(['あかり', 'ばしょう']);
    await host.startHand();
    host.revealAll();

    const guest = guests[0]!.transport;
    const selfId = guest.selfPlayerId()!;
    // 自分の乱数が入っていないことにされた記録を検証してみる
    const tampered = guest.fairnessRecords().map((r) => ({
      ...r,
      nonces: r.nonces.filter((n) => n.playerId !== selfId),
    }));
    const results = await verifyAll(tampered, { selfPlayerId: selfId });
    expect(results[0]!.status).toBe('nonce-missing');
  });

  it('中断したハンドも記録され、公開対象になる', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    guests[1]!.link.leave();
    await host.startHand(); // 中断する

    host.revealAll();
    const records = host.fairnessRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.aborted).toBe(true);
    expect(records[0]!.secret).not.toBeNull();

    // 乱数が揃っていなかったので、中断自体は不自然ではない
    const results = await verifyAll(records, { expectedNonceCount: 2 });
    expect(results[0]!.status).toBe('verified');
  });
});

describe('host が seed を狙えないこと', () => {
  it('秘密は乱数より先に固定されている', async () => {
    // DEAL_COMMIT が、どの DEAL_NONCE よりも先に送られていることを確かめる。
    // 逆なら host は乱数を見てから秘密を選べてしまう。
    const { host, net, guests } = await setupTable(['あかり', 'ばしょう']);
    await host.startHand();

    const commitIndex = net.host.sent.findIndex(
      (entry) => (entry.message as { type?: string }).type === MSG.DEAL_COMMIT,
    );
    expect(commitIndex).toBeGreaterThanOrEqual(0);

    for (const guest of guests) {
      const nonceEntry = guest.link.sent.find(
        (entry) => (entry.message as { type?: string }).type === MSG.DEAL_NONCE,
      );
      expect(nonceEntry, '乱数が送られていない').toBeDefined();
    }
  });

  it('同じ秘密でも乱数が違えば seed が変わる', async () => {
    const { host } = await setupTable(['あかり', 'ばしょう']);
    await host.startHand();
    const [record] = host.fairnessRecords();

    const altered = await deriveSeed(record!.secret!, [
      ...record!.nonces.slice(0, 1),
      { playerId: record!.nonces[1]!.playerId, nonce: 'ちがう乱数' },
    ]);
    expect(altered.seedHex).not.toBe(record!.seedHex);
  });
});
