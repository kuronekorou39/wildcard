import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { legalActions } from '@wildcard/engine';
import { LocalTransport } from '../src/transport/local.js';
import { presentedChips } from '../src/chipPresentation.js';
import { chipsTotal, TABLE_TIMING as T } from '../src/transport/presentation.js';
import { receiveRuntime } from '../src/transport/tableRuntime.js';
import { MSG, parseHostMessage } from '../src/net/protocol.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const table = () => new LocalTransport({ seatCount: 3, smallBlind: 10, bigBlind: 20, paced: true,
  viewer: { kind: 'fixed', playerId: 'p0' },
  setup: [0,1,2].map(seat => ({ type: 'sit', playerId: `p${seat}`, name: `P${seat}`, seat, chips: 1000 })),
});
const settle = (t: LocalTransport) => vi.advanceTimersByTime(Math.max(0, t.snapshot().runtime!.readyAt - Date.now()));
const call = (t: LocalTransport) => { const playerId = t.rawState().turnPlayerId!;
  t.dispatch({ type: legalActions(t.rawState(), playerId)!.canCheck ? 'check' : 'call', playerId }); };

it('blinds and raises stay in front, then collect before the next board without changing denominations', () => {
  const t = table(); t.dispatch({ type: 'startHand', seed: 5 }); settle(t);
  const view = (now = Date.now()) => presentedChips(t.snapshot().runtime!, now);
  expect(view().pot).toEqual([]);
  expect(view().pending).toBe(30);
  expect(view().bets.map(b => chipsTotal(b.chips))).toEqual([10,20]);
  t.dispatch({ type: 'raise', playerId: 'p0', to: 100 });
  expect(view().bets.find(b => b.playerId === 'p0')!.chips).toEqual([]);
  settle(t); expect(view().bets.find(b => b.playerId === 'p0')!.chips).toEqual([{ value: 100, count: 1 }]);
  expect(view().pot).toEqual([]);
  call(t); settle(t); call(t);
  const runtime = t.snapshot().runtime!, collect = runtime.events.find(e => e.kind === 'collect')!;
  expect(collect.at - Date.now()).toBe(T.bet + T.collectPause);
  expect(view(collect.at - 1).bets.reduce((sum,b) => sum + chipsTotal(b.chips),0)).toBe(300);
  expect(view(collect.at).bets).toEqual([]);
  expect(view(collect.at + T.collect - 1).pot).toEqual([]);
  expect(view(collect.at + T.collect - 1).pending).toBe(300);
  expect(view(collect.at + T.collect).pot).toEqual([{ value: 100, count: 1 }, { value: 10, count: 20 }]);
  expect(view(collect.at + T.collect).pending).toBe(0);
  expect(runtime.events.find(e => e.kind === 'burn')!.at).toBeGreaterThanOrEqual(collect.at + T.collect);
  settle(t);
  t.dispatch({ type: 'raise', playerId: 'p1', to: 20 }); settle(t);
  expect(chipsTotal(view().pot)).toBe(300);
  expect(view().pending).toBe(20);
  expect(chipsTotal(view().bets[0]!.chips)).toBe(20);
});

it('SB calls and BB raises add only the difference to their existing front stacks', () => {
  const t = table(); t.dispatch({ type: 'startHand', seed: 5 }); settle(t);
  const view = () => presentedChips(t.snapshot().runtime!, Date.now());
  const bet = (id: string) => view().bets.find(b => b.playerId === id)!.chips;
  call(t); settle(t);
  expect(view().pending).toBe(50);
  call(t);
  expect(bet('p1')).toEqual([{ value: 10, count: 1 }]);
  expect(view().pending).toBe(60);
  expect(view().pot).toEqual([]);
  settle(t);
  expect(bet('p1')).toEqual([{ value: 10, count: 2 }]);
  t.dispatch({ type: 'raise', playerId: 'p2', to: 100 });
  expect(bet('p2')).toEqual([{ value: 10, count: 2 }]);
  expect(view().pending).toBe(140);
  settle(t);
  expect(bet('p2')).toEqual([{ value: 10, count: 10 }]);
  expect(view().pot).toEqual([]);
  expect(view().pending).toBe(140);
});

it('folded bets remain until collection; all-in runouts and refunds collect before payouts', () => {
  for (const allIn of [false, true]) {
    const t = table(); t.dispatch({ type: 'startHand', seed: 7 }); settle(t);
    if (allIn) { t.dispatch({ type: 'raise', playerId: 'p0', to: 1000 }); settle(t); call(t); settle(t); call(t); }
    else { t.dispatch({ type: 'fold', playerId: 'p0' }); settle(t); t.dispatch({ type: 'fold', playerId: 'p1' }); }
    const runtime = t.snapshot().runtime!, collect = runtime.events.find(e => e.kind === 'collect')!;
    const total = allIn ? 3000 : 30;
    expect(presentedChips(runtime, collect.at - 1).bets.reduce((s,b) => s + chipsTotal(b.chips),0)).toBe(total);
    expect(chipsTotal(presentedChips(runtime, collect.at + T.collect).pot)).toBe(total);
    expect(runtime.events.find(e => e.kind === 'win')!.at).toBeGreaterThan(collect.at + T.collect);
    expect(parseHostMessage({ type: MSG.STATE, state: t.snapshot().state, runtime, serverNow: Date.now() })).not.toBeNull();
    const shifted = receiveRuntime(runtime, Date.now() - 50000);
    expect(presentedChips(shifted, collect.at + T.collect + 50000)).toEqual(presentedChips(runtime, collect.at + T.collect));
  }
});
