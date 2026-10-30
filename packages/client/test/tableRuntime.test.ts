import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STANDARD_VARIANT, legalActions } from '@wildcard/engine';
import { LocalTransport } from '../src/transport/local.js';
import { receiveRuntime } from '../src/transport/tableRuntime.js';
import { HostTransport } from '../src/transport/host.js';
import { GuestTransport } from '../src/transport/guest.js';
import { FakeNetwork } from './fakeLink.js';
import { MSG } from '../src/net/protocol.js';
import { chipsTotal, TABLE_TIMING as T } from '../src/transport/presentation.js';
import { presentedChips } from '../src/chipPresentation.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

const table = (hotseat = false, runs = false, paced = false, ante = 0) => new LocalTransport({
  ante,
  paced, ...(paced ? { autoNextHandMs: T.nextHand } : {}),
  seatCount: 3, smallBlind: 10, bigBlind: 20, turnTimeMs: 1000,
  viewer: hotseat ? { kind: 'followTurn' } : { kind: 'fixed', playerId: 'p0' },
  variant: runs ? { ...STANDARD_VARIANT, options: { ...STANDARD_VARIANT.options, runItTwice: { max: 2 } } } : STANDARD_VARIANT,
  setup: [0, 1, 2].map(seat => ({ type: 'sit', playerId: `p${seat}`, name: `Player${seat}`, seat, chips: 1000 })),
});

const settle = (t: LocalTransport) => vi.advanceTimersByTime(Math.max(0, t.snapshot().runtime!.readyAt - Date.now()));

describe('演出を待つ進行と次のハンド', () => {
  it('only antes appear in the center until the first betting round closes', () => {
    const t = table(false, false, true, 5); start(t); settle(t);
    let chips = presentedChips(t.snapshot().runtime!, Date.now());
    expect(chipsTotal(chips.pot)).toBe(15);
    expect(chips.pending).toBe(30);
    call(t); settle(t); call(t); settle(t);
    chips = presentedChips(t.snapshot().runtime!, Date.now());
    expect(chipsTotal(chips.pot)).toBe(15);
    expect(chips.bets.map(b => chipsTotal(b.chips)).sort()).toEqual([20, 20, 20]);
    call(t); settle(t);
    chips = presentedChips(t.snapshot().runtime!, Date.now());
    expect(chipsTotal(chips.pot)).toBe(75);
    expect(chips.pending).toBe(0);
    t.dispose();
  });
  it('配牌と場札が揃うまで次の操作を受け付けず、持ち時間を消費しない', () => {
    const t = table(false, false, true); start(t);
    const ready = t.snapshot().runtime!.readyAt;
    expect(ready - Date.now()).toBeGreaterThan(1500);
    call(t);
    expect(t.rawState().turnPlayerId).toBe('p0');
    settle(t);
    expect(t.snapshot().runtime!.clock!.deadline! - Date.now()).toBe(1000);
    call(t); settle(t); call(t); settle(t); call(t);
    const events = t.snapshot().runtime!.events;
    const burn = events.find(e => e.kind === 'burn')!;
    const board = events.find(e => e.kind === 'board')!;
    expect(board.at).toBeGreaterThanOrEqual(burn.at + T.card);
    expect(t.snapshot().runtime!.readyAt).toBeGreaterThan(board.at + T.card);
    const turn = t.rawState().turnPlayerId;
    call(t); expect(t.rawState().turnPlayerId).toBe(turn);
  });
  it('オールインでもフロップ、ターン、リバー、配当の順序と間を保つ', () => {
    const t = table(false, false, true); start(t); settle(t);
    t.dispatch({ type: 'raise', playerId: 'p0', to: 1000 }); settle(t); call(t); settle(t); call(t);
    const events = t.snapshot().runtime!.events;
    const boards = events.filter(e => e.kind === 'board');
    expect(boards.map(e => e.kind === 'board' && e.count)).toEqual([3, 1, 1]);
    expect(boards[1]!.at - boards[0]!.at).toBeGreaterThan(1800);
    expect(boards[2]!.at - boards[1]!.at).toBeGreaterThan(1800);
    const win = events.find(e => e.kind === 'win')!;
    expect(win.at).toBeGreaterThanOrEqual(boards[2]!.at + T.card + T.showdownPause);
    expect(t.snapshot().runtime!.readyAt).toBe(win.at + T.win);
  });
  it('配当後8秒で一度だけ自動開始し、次のハンドでチップの記録を作り直す', () => {
    const t = table(false, false, true); start(t); settle(t);
    t.dispatch({ type: 'fold', playerId: 'p0' }); settle(t);
    t.dispatch({ type: 'fold', playerId: 'p1' });
    const runtime = t.snapshot().runtime!;
    expect(runtime.nextHandAt).toBe(runtime.readyAt + T.nextHand);
    vi.advanceTimersByTime(runtime.nextHandAt! - Date.now() - 1);
    expect(t.rawState().phase).toBe('showdown');
    vi.advanceTimersByTime(1);
    expect(t.rawState().phase).toBe('betting');
    expect(t.snapshot().runtime!.handId).toBe(2);
    expect(chipsTotal(t.snapshot().runtime!.potChips)).toBe(t.rawState().pot);
    expect(t.snapshot().runtime!.nextHandAt).toBeNull();
  });
  it('自動開始は停止でき、退出後も勝手に配らない', () => {
    for (const cancel of [true, false]) {
      const t = table(false, false, true); start(t); settle(t);
      t.dispatch({ type: 'fold', playerId: 'p0' }); settle(t);
      t.dispatch({ type: 'fold', playerId: 'p1' });
      if (cancel) t.cancelNextHand(); else t.dispose();
      vi.advanceTimersByTime(20000);
      expect(t.rawState().phase).toBe('showdown');
      expect(t.snapshot().runtime!.handId).toBe(1);
    }
  });
  it('手渡し画面で公開しても配牌の間は手番の時間を減らさない', () => {
    const t = table(true, false, true); start(t); t.revealTurn();
    expect(t.snapshot().runtime!.clock!.deadline).toBe(t.snapshot().runtime!.readyAt + 1000);
    settle(t); vi.advanceTimersByTime(999);
    expect(t.rawState().players[0]!.folded).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.rawState().players[0]!.folded).toBe(true);
  });
});

describe('ポットに出たチップを両替しない', () => {
  it('20ずつ集めて100を超えても10のチップのまま残る', () => {
    const t = table(); start(t); call(t); call(t); call(t);
    expect(t.snapshot().runtime!.potChips).toEqual([{ value: 10, count: 6 }]);
    t.dispatch({ type: 'raise', playerId: 'p1', to: 20 }); call(t); call(t);
    expect(t.rawState().pot).toBe(120);
    expect(t.snapshot().runtime!.potChips).toEqual([{ value: 10, count: 12 }]);
    t.dispatch({ type: 'raise', playerId: 'p1', to: 100 });
    expect(t.snapshot().runtime!.potChips).toEqual([{ value: 100, count: 1 }, { value: 10, count: 12 }]);
    expect(chipsTotal(t.snapshot().runtime!.potChips)).toBe(t.rawState().pot);
  });
  it('配当直前も最後のコールまで内訳を保持する', () => {
    const t = table(); start(t); t.dispatch({ type: 'raise', playerId: 'p0', to: 1000 }); call(t); call(t);
    expect(t.rawState().pot).toBe(0);
    expect(chipsTotal(t.snapshot().runtime!.potChips)).toBe(3000);
    expect(t.snapshot().runtime!.potChips).toEqual([{ value: 1000, count: 1 }, { value: 100, count: 18 }, { value: 10, count: 20 }]);
  });
});
const start = (t: LocalTransport) => t.dispatch({ type: 'startHand', seed: 5 });
const call = (t: LocalTransport) => {
  const playerId = t.rawState().turnPlayerId!;
  t.dispatch({ type: legalActions(t.rawState(), playerId)!.canCheck ? 'check' : 'call', playerId });
};

describe('手番の制限時間', () => {
  it('時間切れでフォールドし、次の手番に新しい期限を渡す', () => {
    const t = table(); start(t);
    const first = t.snapshot().runtime!.clock!;
    vi.advanceTimersByTime(999);
    expect(t.rawState().turnPlayerId).toBe('p0');
    vi.advanceTimersByTime(1);
    expect(t.rawState().players[0]!.folded).toBe(true);
    expect(t.snapshot().runtime!.clock).toMatchObject({ id: first.id + 1, playerId: 'p1', deadline: 102000 });
  });
  it('無料でチェックできる時は降りずにチェックする', () => {
    const t = table(); start(t); call(t); call(t);
    vi.advanceTimersByTime(1000);
    expect(t.rawState().players[2]!.folded).toBe(false);
    expect(t.rawState().communityCards).toHaveLength(3);
  });
  it('手渡し中は停止し、本人が開いてから数える', () => {
    const t = table(true); start(t);
    vi.advanceTimersByTime(60_000);
    expect(t.rawState().turnPlayerId).toBe('p0');
    expect(t.snapshot().runtime!.clock!.deadline).toBeNull();
    t.revealTurn(); vi.advanceTimersByTime(500); t.revealTurn(); vi.advanceTimersByTime(500);
    expect(t.rawState().players[0]!.folded).toBe(true);
    expect(t.snapshot().runtime!.clock!.deadline).toBeNull();
  });
  it('手札の公開や無効な操作で期限を延長しない', () => {
    const t = table(); start(t);
    const clock = t.snapshot().runtime!.clock;
    vi.advanceTimersByTime(700);
    t.dispatch({ type: 'showCard', playerId: 'p0', index: 0 });
    t.dispatch({ type: 'raise', playerId: 'p1', to: 100 });
    expect(t.snapshot().runtime!.clock).toEqual(clock);
    vi.advanceTimersByTime(300);
    expect(t.rawState().players[0]!.folded).toBe(true);
  });
  it('離脱すると停止し、復帰では元の期限を守る', () => {
    const t = table(); start(t); t.dispose();
    vi.advanceTimersByTime(5000);
    expect(t.rawState().players[0]!.folded).toBe(false);
    t.resume(); vi.advanceTimersByTime(0);
    expect(t.rawState().players[0]!.folded).toBe(true);
  });
  it('端末の休止から戻った直後の期限切れアクションも通さない', () => {
    const t = table(); start(t);
    vi.setSystemTime(102000);
    t.dispatch({ type: 'raise', playerId: 'p0', to: 200 });
    expect(t.rawState().players[0]!.folded).toBe(true);
    expect(t.rawState().currentBet).toBe(20);
  });
  it('本数の選択も期限を過ぎると1本で終わる', () => {
    const t = table(false, true); start(t);
    t.dispatch({ type: 'raise', playerId: 'p0', to: 1000 }); call(t); call(t);
    expect(t.rawState().phase).toBe('runChoice');
    vi.advanceTimersByTime(1000);
    expect(t.rawState().phase).toBe('showdown');
    expect(t.rawState().extraBoards).toHaveLength(0);
    expect(t.snapshot().runtime!.clock).toBeNull();
  });
});

describe('公開してよい演出データ', () => {
  it('配牌、バーン、フロップ、ベット、配当を記録し、秘密の札を含めない', () => {
    const t = table(); start(t);
    expect(t.snapshot().runtime!.events.map(e => e.kind)).toEqual(['deal', 'bet', 'bet']);
    call(t); call(t); call(t);
    expect(t.snapshot().runtime!.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'burn', count: 1 }),
      expect.objectContaining({ kind: 'board', run: 0, from: 0, count: 3 }),
    ]));
    expect(JSON.stringify(t.snapshot().runtime)).not.toMatch(/suit|rank|holeCards|deck/);
    t.dispatch({ type: 'raise', playerId: t.rawState().turnPlayerId!, to: 980 }); call(t); call(t);
    expect(t.rawState().phase).toBe('showdown');
    const events = t.snapshot().runtime!.events;
    expect(events.filter(e => e.kind === 'bet').reduce((sum, e) => sum + ('amount' in e ? e.amount : 0), 0)).toBe(3000);
    expect(events.filter(e => e.kind === 'win').reduce((sum, e) => sum + ('amount' in e ? e.amount : 0), 0)).toBe(3000);
  });
  it('ゲストの時計が違っても残り時間と演出の経過時間を保持する', () => {
    const t = table(); start(t); vi.advanceTimersByTime(400);
    const runtime = t.snapshot().runtime!;
    vi.setSystemTime(9_000_000);
    const received = receiveRuntime(runtime, 100400);
    expect(received.clock!.deadline! - Date.now()).toBe(600);
    expect(Date.now() - received.events[0]!.at).toBe(400);
  });
});

describe('オンライン卓の期限と二重送信', () => {
  it('ホストだけが期限を実行し、過去の手番の再送を拒否する', async () => {
    const net = new FakeNetwork();
    const host = new HostTransport({ link: net.host, roomCode: 'ABCDEF', hostName: 'Host', hostPlays: true,
      startingChips: 1000, seatCount: 2, smallBlind: 10, bigBlind: 20, ante: 5, turnTimeMs: 10000 });
    await host.start();
    const link = net.createGuest();
    const guest = new GuestTransport({ link, roomCode: 'ABCDEF', sessionId: 'guest', name: 'Guest' });
    await guest.start(); net.connect(link);
    host.dispatch({ type: 'startHand', seed: 1 });
    expect(guest.snapshot().state.ante).toBe(5);
    expect(guest.snapshot().state.pot).toBe(40);
    expect(guest.snapshot().state.players.reduce((sum, p) => sum + p.bet, 0)).toBe(30);
    host.dispatch({ type: 'call', playerId: host.rawState().turnPlayerId! });
    const id = guest.snapshot().viewerId!;
    const oldTurn = guest.snapshot().runtime!.clock!.id;
    const deadline = guest.snapshot().runtime!.clock!.deadline;
    vi.advanceTimersByTime(5000); // Heartbeat republishes state, without granting more time.
    expect(guest.snapshot().runtime!.clock!.deadline).toBe(deadline);
    guest.dispatch({ type: 'check', playerId: id });
    // BB acts again first on the flop. An old click would be legal without its turn token.
    expect(host.rawState().turnPlayerId).toBe(id);
    link.injectToPeer({ type: MSG.ACTION, turnId: oldTurn, action: { type: 'fold', playerId: id } });
    expect(host.rawState().players.find(p => p.id === id)!.folded).toBe(false);
    vi.advanceTimersByTime(10000);
    expect(host.rawState().turnPlayerId).not.toBe(id);
    expect(guest.snapshot().state.turnPlayerId).toBe(host.rawState().turnPlayerId);
    expect(guest.snapshot().runtime!.clock).toEqual(host.snapshot().runtime!.clock);
    host.close();
  });
});
