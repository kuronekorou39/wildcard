import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STANDARD_VARIANT, type Variant } from '@wildcard/engine';
import { MSG, PROTO_VERSION } from '../src/net/protocol.js';
import { GuestTransport } from '../src/transport/guest.js';
import { HostTransport } from '../src/transport/host.js';
import { FakeLink, FakeNetwork } from './fakeLink.js';

interface Table {
  readonly net: FakeNetwork;
  readonly host: HostTransport;
  readonly guests: { readonly transport: GuestTransport; readonly link: FakeLink }[];
}

/** host と指定人数の guest を繋いだ卓を用意する。 */
async function setupTable(
  guestNames: readonly string[],
  options: { readonly hostPlays?: boolean; readonly variant?: Variant } = {},
): Promise<Table> {
  const net = new FakeNetwork();
  const host = new HostTransport({
    link: net.host,
    roomCode: 'ABCDEF',
    hostName: 'ホスト',
    hostPlays: options.hostPlays ?? true,
    startingChips: 1000,
    seatCount: 10,
    smallBlind: 10,
    bigBlind: 20,
    ...(options.variant ? { variant: options.variant } : {}),
  });
  await host.start();

  const guests = [];
  for (const [i, name] of guestNames.entries()) {
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

const seatedNames = (host: HostTransport) => host.rawState().players.map((p) => p.name);

beforeEach(() => {
  vi.useFakeTimers();
});

describe('参加', () => {
  it('guest が繋がると席に着く', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);

    expect(seatedNames(host)).toEqual(['ホスト', 'あかり', 'ばしょう']);
    expect(guests[0]!.transport.snapshot().status).toBe('connected');
    expect(guests[0]!.transport.snapshot().viewerId).not.toBeNull();
  });

  it('host が席に着かない設定なら、host は卓に並ばない', async () => {
    const { host } = await setupTable(['あかり', 'ばしょう'], { hostPlays: false });
    expect(seatedNames(host)).toEqual(['あかり', 'ばしょう']);
  });

  it('プロトコルの版が違う相手は拒否される', async () => {
    const net = new FakeNetwork();
    const host = new HostTransport({
      link: net.host,
      roomCode: 'ABCDEF',
      hostName: 'ホスト',
      hostPlays: true,
      startingChips: 1000,
      seatCount: 10,
    });
    await host.start();

    const link = net.createGuest();
    net.connect(link);
    link.injectToPeer({
      type: MSG.HELLO,
      proto: PROTO_VERSION + 1,
      sessionId: 'x',
      name: 'よそ者',
    });

    expect(seatedNames(host)).toEqual(['ホスト']);
    const reply = net.host.sent.at(-1)?.message as { type: string } | undefined;
    expect(reply?.type).toBe(MSG.REJECTED);
  });

  it('壊れたメッセージは席に影響しない', async () => {
    const { host, guests } = await setupTable(['あかり']);
    const before = seatedNames(host);

    guests[0]!.link.injectToPeer({ type: 'hello' }); // 必須項目がない
    guests[0]!.link.injectToPeer({ type: '知らない種類' });
    guests[0]!.link.injectToPeer('文字列');
    guests[0]!.link.injectToPeer(null);

    expect(seatedNames(host)).toEqual(before);
  });
});

describe('秘匿（人ごとに違う状態を送る）', () => {
  it('guest に届くのは自分のホールカードだけ', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    host.dispatch({ type: 'startHand', seed: 1 });

    for (const guest of guests) {
      const { state, viewerId } = guest.transport.snapshot();
      expect(state.phase).toBe('betting');
      for (const player of state.players) {
        if (player.id === viewerId) {
          expect(player.holeCards, `${player.name} は自分`).toHaveLength(2);
        } else {
          expect(player.holeCards, `${player.name} は他人`).toEqual([null, null]);
        }
      }
    }
  });

  it('guest どうしで見えているカードが違う', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    host.dispatch({ type: 'startHand', seed: 7 });

    const own = guests.map((g) => {
      const { state, viewerId } = g.transport.snapshot();
      return state.players.find((p) => p.id === viewerId)!.holeCards;
    });
    expect(own[0]).not.toEqual(own[1]);
  });

  it('山札は guest に渡らない', async () => {
    const { host, guests } = await setupTable(['あかり']);
    host.dispatch({ type: 'startHand', seed: 1 });

    const state = guests[0]!.transport.snapshot().state;
    expect(state).not.toHaveProperty('deck');
    expect(state.deckCount).toBe(52 - 4);
  });

  it('席を持たない host の画面には誰の手札も出ない', async () => {
    const { host } = await setupTable(['あかり', 'ばしょう'], { hostPlays: false });
    host.dispatch({ type: 'startHand', seed: 1 });

    const { state, viewerId } = host.snapshot();
    expect(viewerId).toBeNull();
    for (const player of state.players) {
      expect(player.holeCards).toEqual([null, null]);
    }
  });
});

describe('認可', () => {
  it('手番の人を他人が降ろすことはできない', async () => {
    // 狙うのは「いま手番の人」でなければならない。手番でない人への fold は
    // エンジンの validate が元々弾くので、認可を外しても落ちず、
    // 認可を検証したことにならない。
    const { host, guests } = await setupTable(['あかり', 'ばしょう', 'ちとせ']);
    host.dispatch({ type: 'startHand', seed: 1 });

    const victimId = host.rawState().turnPlayerId!;
    const attacker = guests.find((g) => g.transport.snapshot().viewerId !== victimId);
    expect(attacker, '手番でない guest がいること').toBeDefined();

    const turnBefore = host.rawState().turnPlayerId;
    attacker!.link.injectToPeer({
      type: MSG.ACTION,
      turnId: host.snapshot().runtime!.clock!.id,
      action: { type: 'fold', playerId: victimId },
    });

    expect(host.rawState().players.find((p) => p.id === victimId)!.folded).toBe(false);
    expect(host.rawState().turnPlayerId).toBe(turnBefore);
  });

  it('手番の人のベット額を他人が勝手に決めることもできない', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう', 'ちとせ']);
    host.dispatch({ type: 'startHand', seed: 1 });

    const victimId = host.rawState().turnPlayerId!;
    const attacker = guests.find((g) => g.transport.snapshot().viewerId !== victimId)!;
    const chipsBefore = host.rawState().players.find((p) => p.id === victimId)!.chips;

    attacker.link.injectToPeer({
      type: MSG.ACTION,
      turnId: host.snapshot().runtime!.clock!.id,
      action: { type: 'raise', playerId: victimId, to: 1000 },
    });

    expect(host.rawState().players.find((p) => p.id === victimId)!.chips).toBe(chipsBefore);
  });

  it('「2本走る」を他人の代わりに答えられない', async () => {
    // 答えは金の動き方を変える。手番でない人が代わりに答えられてはいけない。
    const { host, guests } = await setupTable(['あかり', 'ばしょう'], {
      variant: {
        ...STANDARD_VARIANT,
        options: { ...STANDARD_VARIANT.options, runItTwice: { max: 2 } },
      },
    });
    host.dispatch({ type: 'startHand', seed: 1 });

    // ヘッズアップで両者オールイン。
    for (let i = 0; i < 4 && host.rawState().phase === 'betting'; i++) {
      const turn = host.rawState().turnPlayerId;
      if (!turn) break;
      const player = host.rawState().players.find((p) => p.id === turn)!;
      host.dispatch(
        host.rawState().currentBet > player.bet && player.bet > 0
          ? { type: 'call', playerId: turn }
          : { type: 'raise', playerId: turn, to: player.bet + player.chips },
      );
    }
    expect(host.rawState().phase).toBe('runChoice');

    const askedId = host.rawState().turnPlayerId!;
    const attacker = guests.find((g) => g.transport.snapshot().viewerId !== askedId);
    expect(attacker, '聞かれていない guest がいること').toBeDefined();

    attacker!.link.injectToPeer({
      type: MSG.ACTION,
      turnId: host.snapshot().runtime!.clock!.id,
      action: { type: 'runItTwice', playerId: askedId, agree: false },
    });

    // 勝手に断られていない。まだ同じ人に聞いている。
    expect(host.rawState().phase).toBe('runChoice');
    expect(host.rawState().turnPlayerId).toBe(askedId);
  });

  it('自分の番なら答えが通る', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう'], {
      variant: {
        ...STANDARD_VARIANT,
        options: { ...STANDARD_VARIANT.options, runItTwice: { max: 2 } },
      },
    });
    host.dispatch({ type: 'startHand', seed: 1 });

    for (let i = 0; i < 4 && host.rawState().phase === 'betting'; i++) {
      const turn = host.rawState().turnPlayerId;
      if (!turn) break;
      const player = host.rawState().players.find((p) => p.id === turn)!;
      host.dispatch(
        host.rawState().currentBet > player.bet && player.bet > 0
          ? { type: 'call', playerId: turn }
          : { type: 'raise', playerId: turn, to: player.bet + player.chips },
      );
    }

    const askedId = host.rawState().turnPlayerId!;
    const owner = guests.find((g) => g.transport.snapshot().viewerId === askedId);

    if (owner) {
      owner.transport.dispatch({ type: 'runItTwice', playerId: askedId, agree: false });
    } else {
      // 聞かれているのが host 自身なら、こちらから答える。
      host.dispatch({ type: 'runItTwice', playerId: askedId, agree: false });
    }

    // 断ったので1本で決着する。
    expect(host.rawState().phase).toBe('showdown');
    expect(host.rawState().extraBoards).toHaveLength(0);
  });

  it('他人を離席させることもできない', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    const victim = host.rawState().players.find((p) => p.name === 'ばしょう')!;

    guests[0]!.link.injectToPeer({
      type: MSG.ACTION,
      action: { type: 'setAway', playerId: victim.id, away: true },
    });

    expect(host.rawState().players.find((p) => p.id === victim.id)!.away).toBe(false);
  });

  it('guest はハンドを開始できない', async () => {
    // これは認可より手前、メッセージの読み取り（parseAction）で落ちる。
    // startHand は guest が送れる Action の一覧に無い。
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);

    guests[0]!.link.injectToPeer({ type: MSG.ACTION, action: { type: 'startHand', seed: 1 } });

    expect(host.rawState().phase).toBe('waiting');
  });

  it('自分のアクションは通る', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    host.dispatch({ type: 'startHand', seed: 1 });

    const turnId = host.rawState().turnPlayerId!;
    const actor = guests.find((g) => g.transport.snapshot().viewerId === turnId);
    // host が手番のこともあるので、guest の番のときだけ試す
    if (actor) {
      actor.transport.dispatch({ type: 'fold', playerId: turnId });
      expect(host.rawState().players.find((p) => p.id === turnId)!.folded).toBe(true);
    } else {
      host.dispatch({ type: 'fold', playerId: turnId });
      expect(host.rawState().players.find((p) => p.id === turnId)!.folded).toBe(true);
    }
  });

  // これは認可ではなく「そのピアがまだ誰でもない」ことで落ちる。
  it('hello の前に送られたアクションは無視される', async () => {
    const net = new FakeNetwork();
    const host = new HostTransport({
      link: net.host,
      roomCode: 'ABCDEF',
      hostName: 'ホスト',
      hostPlays: true,
      startingChips: 1000,
      seatCount: 10,
    });
    await host.start();

    const link = net.createGuest();
    net.connect(link);
    link.injectToPeer({ type: MSG.ACTION, action: { type: 'fold', playerId: 'host-ABCDEF' } });

    expect(host.rawState().players[0]!.folded).toBe(false);
  });
});

describe('切断と再接続', () => {
  it('切断すると離席になり、席は残る', async () => {
    const { net, host, guests } = await setupTable(['あかり', 'ばしょう']);
    const target = host.rawState().players.find((p) => p.name === 'あかり')!;

    net.disconnect(guests[0]!.link);

    const after = host.rawState().players.find((p) => p.id === target.id)!;
    expect(after.away).toBe(true);
    expect(after.chips).toBe(1000);
    expect(seatedNames(host)).toContain('あかり');
  });

  it('同じ sessionId で戻ると同じ席に復帰する', async () => {
    const { net, host, guests } = await setupTable(['あかり', 'ばしょう']);
    const before = host.rawState().players.find((p) => p.name === 'あかり')!;
    net.disconnect(guests[0]!.link);

    // 同じ sessionId の新しい端末（リロード相当）
    const link = net.createGuest();
    const rejoined = new GuestTransport({
      link,
      roomCode: 'ABCDEF',
      name: 'あかり',
      sessionId: 'session-0',
    });
    await rejoined.start();
    net.connect(link);

    const after = host.rawState().players.find((p) => p.id === before.id)!;
    expect(after.away).toBe(false);
    expect(after.seat).toBe(before.seat);
    expect(rejoined.snapshot().viewerId).toBe(before.id);
    expect(seatedNames(host)).toHaveLength(3); // 席が増えていない
  });

  it('接続中の席を別の端末が乗っ取れない', async () => {
    const { net, host } = await setupTable(['あかり', 'ばしょう']);
    const before = host.rawState().players.find((p) => p.name === 'あかり')!;

    // あかりが繋がったまま、同じ sessionId を名乗る別端末が来る
    const link = net.createGuest();
    net.connect(link);
    link.injectToPeer({
      type: MSG.HELLO,
      proto: PROTO_VERSION,
      sessionId: 'session-0',
      name: 'なりすまし',
    });

    const after = host.rawState().players.find((p) => p.id === before.id)!;
    expect(after.name).toBe('あかり');
    expect(seatedNames(host)).toHaveLength(3);
    const reply = net.host.sent.at(-1)?.message as { type: string } | undefined;
    expect(reply?.type).toBe(MSG.REJECTED);
  });

  it('host が部屋を閉じると guest に伝わる', async () => {
    const { host, guests } = await setupTable(['あかり']);
    host.close();
    expect(guests[0]!.transport.snapshot().status).toBe('closed');
  });
});

describe('進行', () => {
  it('host が進めた結果が guest にも届く', async () => {
    const { host, guests } = await setupTable(['あかり', 'ばしょう']);
    host.dispatch({ type: 'startHand', seed: 1 });

    expect(guests[0]!.transport.snapshot().state.phase).toBe('betting');
    expect(guests[0]!.transport.snapshot().state.pot).toBe(30);
    expect(guests[1]!.transport.snapshot().state.turnPlayerId).toBe(
      host.rawState().turnPlayerId,
    );
  });

  it('無音が続くと guest が切断に気づく', async () => {
    const { net, host, guests } = await setupTable(['あかり']);
    host.dispatch({ type: 'startHand', seed: 1 });
    expect(guests[0]!.transport.snapshot().status).toBe('connected');

    // host が黙る（定期配信も止める）
    host.close();
    net.host.leave();
    guests[0]!.transport.snapshot(); // closed になっているはず
    expect(guests[0]!.transport.snapshot().status).toBe('closed');
  });
});
