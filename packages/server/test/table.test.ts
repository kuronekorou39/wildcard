import { describe, expect, it } from 'vitest';
import { createRng, legalActions, STANDARD_VARIANT } from '@wildcard/engine';
import { parseCommand, type CommandRequest, type TableCommand } from '@wildcard/table';
import { TableSession, readOptions, type StoredTable } from '../src/table.js';

const options = { name: '主催者', chips: 1000, smallBlind: 10, bigBlind: 20, seatCount: 10, hostPlays: true, variant: STANDARD_VARIANT };
const words = (seed: number) => { const rng = createRng(seed); return Array.from({ length: 2000 }, () => Math.floor(rng() * 0x100000000)); };
function fixture(count = 3) {
  const session = TableSession.create('room', options, 'host', 100_000, 3_600_000);
  for (let i = 1; i < count; i++) session.join(`token${i}`, `P${i}`, true);
  const online = session.data.members.map(member => member.playerId!);
  let data = session.data;
  const restore = (now = Math.max(100_000, data.runtime.readyAt + 1)) => new TableSession(structuredClone(data), now, () => words(72));
  const request = (command: TableCommand, memberIndex = 0): CommandRequest => ({ type: 'command', id: crypto.randomUUID(),
    seq: (data.members[memberIndex]!.lastReceipt?.seq ?? 0) + 1, handId: data.runtime.handId,
    turnId: data.runtime.clock?.id ?? null, command });
  const act = (command: TableCommand, memberIndex = 0, savedRequest?: CommandRequest) => {
    const next = restore();
    const receipt = next.command(next.data.members[memberIndex]!, savedRequest ?? request(command, memberIndex), online);
    data = next.data;
    return { next, receipt };
  };
  const call = () => {
    const i = data.members.findIndex(member => member.playerId === data.game.turnPlayerId);
    return act({ type: legalActions(data.game, data.game.turnPlayerId!)!.canCheck ? 'check' : 'call' }, i);
  };
  return { get data() { return data; }, online, restore, request, act, call, set(value: StoredTable) { data = value; } };
}

describe('永続する卓の進行', () => {
  it('新規着席は空いている間隔を優先し、再接続しても席を動かさない', () => {
    const session = TableSession.create('room', options, 'host', 100_000, 3_600_000);
    for (let i = 1; i < 10; i++) {
      const before = session.data.game.players.map(player => player.seat);
      const distance = (seat: number) => Math.min(...before.map(other => Math.min(Math.abs(seat - other), 10 - Math.abs(seat - other))));
      const best = Math.max(...Array.from({ length: 10 }, (_, seat) => distance(seat)));
      const member = session.join(`join${i}`, `P${i}`, true);
      const seat = session.data.game.players.find(player => player.id === member.playerId)!.seat;
      expect(distance(seat)).toBe(best);
      expect(session.join(`join${i}`, `P${i}`, true)).toBe(member);
      expect(session.data.game.players.find(player => player.id === member.playerId)!.seat).toBe(seat);
    }
    expect(new Set(session.data.game.players.map(player => player.seat)).size).toBe(10);
    expect(() => session.join('full', '満席', true)).toThrow('満席');
  });
  it('期限後は最後のハンドだけを精算し、削除猶予中も新規参加と次の配牌を拒否する', () => {
    const t = fixture(); t.act({ type: 'start' });
    const expiry = t.data.runtime.clock!.deadline!;
    t.data.expiresAt = expiry;
    t.data.cleanupAt = expiry + 3_600_000;
    for (let i = 0; t.data.game.phase !== 'showdown' && i < 10; i++) {
      const step = t.restore(t.data.runtime.clock!.deadline!); step.tick(t.online); t.set(step.data);
    }
    expect(t.data.game.phase).toBe('showdown');
    const done = t.restore(t.data.runtime.nextHandAt!);
    expect(() => done.join('new-member', '参加者', true)).toThrow('保存期間');
    done.tick(t.online);
    expect(done.data.runtime.handId).toBe(1);
    expect(done.data.runtime.nextHandAt).toBeNull();
    expect(done.startReason(t.online)).toContain('保存期間');
  });
  it('10人で毎操作ごとに復元し、最後まで進行してチップを保存する', () => {
    const t = fixture(10);
    expect(t.act({ type: 'start' }).receipt.ok).toBe(true);
    for (let n = 0; t.data.game.phase !== 'showdown' && n < 60; n++) expect(t.call().receipt.ok).toBe(true);
    expect(t.data.game.phase).toBe('showdown');
    expect(t.data.game.players.reduce((sum, player) => sum + player.chips, 0)).toBe(10000);
    expect(t.data.game.history?.some(step => step.kind === 'collect')).toBe(true);
    expect(t.data.runtime.nextHandAt).toBeGreaterThan(t.data.runtime.readyAt);
  });
  it('応答を失って再送しても一度しかベットしない。別内容で同じ番号も再実行しない', () => {
    const t = fixture(); t.act({ type: 'start' });
    const i = t.data.members.findIndex(member => member.playerId === t.data.game.turnPlayerId);
    const request = t.request({ type: 'call' }, i);
    const first = t.act({ type: 'call' }, i, request);
    const after = structuredClone(t.data.game);
    expect(t.act({ type: 'call' }, i, request).receipt).toEqual(first.receipt);
    expect(t.data.game).toEqual(after);
    expect(t.act({ type: 'fold' }, i, { ...request, command: { type: 'fold' } }).receipt.ok).toBe(false);
    expect(t.data.game).toEqual(after);
  });
  it('期限切れを再起動後に適用し、同じ時刻のアラームで二度進めない', () => {
    const t = fixture(); t.act({ type: 'start' });
    const deadline = t.data.runtime.clock!.deadline!;
    const first = t.data.game.turnPlayerId;
    const restored = t.restore(deadline + 1);
    restored.tick(t.online);
    expect(restored.data.game.players.find(player => player.id === first)?.folded).toBe(true);
    const next = structuredClone(restored.data);
    new TableSession(next, deadline + 1).tick(t.online);
    expect(next.game).toEqual(restored.data.game);
    expect(next.runtime.clock!.deadline).toBeGreaterThan(deadline);
  });
  it('期限処理のチェック、ランアウトと次のハンドも保存した期限から進む', () => {
    const t = fixture(2); t.act({ type: 'start' }); t.call();
    const check = t.restore(t.data.runtime.clock!.deadline!);
    check.tick(t.online);
    expect(check.data.game.players.every(player => !player.folded)).toBe(true);
    t.set(check.data);
    const index = t.data.members.findIndex(member => member.playerId === t.data.game.turnPlayerId);
    t.act({ type: 'raise', to: 980 }, index); t.call();
    expect(t.data.game.phase).toBe('showdown');
    const resumed = t.restore(t.data.runtime.nextHandAt!);
    resumed.tick(t.online);
    // A winner-takes-all hand may leave only one funded seat; no empty auto-deal.
    expect(resumed.data.runtime.nextHandAt).toBeNull();
    expect(resumed.data.runtime.handId).toBeLessThanOrEqual(2);
  });
  it('全員切断後は次のハンドを始めず、主催者不在でも現在のハンドは終える', () => {
    const t = fixture(); t.act({ type: 'start' });
    for (let i = 0; t.data.game.phase !== 'showdown' && i < 10; i++) {
      const step = t.restore(t.data.runtime.clock!.deadline!); step.tick([]); t.set(step.data);
    }
    expect(t.data.game.phase).toBe('showdown');
    const done = t.restore(t.data.runtime.nextHandAt!); done.tick([]);
    expect(done.data.runtime.handId).toBe(1);
    expect(done.data.runtime.nextHandAt).toBeNull();
  });
  it('ゲストに開始権限はなく、他人の手番にも行動できない', () => {
    const t = fixture();
    expect(t.act({ type: 'start' }, 1).receipt.ok).toBe(false);
    t.act({ type: 'start' });
    const i = t.data.members.findIndex(member => member.playerId !== t.data.game.turnPlayerId);
    const before = t.data.game;
    expect(t.act({ type: 'call' }, i).receipt.ok).toBe(false);
    expect(t.data.game).toEqual(before);
  });
  it('古い手番の予約操作を次の手番へ流用しない', () => {
    const t = fixture(); t.act({ type: 'start' });
    const i = t.data.members.findIndex(member => member.playerId === t.data.game.turnPlayerId);
    const old = t.request({ type: 'fold' }, i);
    t.call(); t.call(); t.call();
    const request = { ...old, seq: (t.data.members[i]!.lastReceipt?.seq ?? 0) + 1 };
    expect(t.act({ type: 'fold' }, i, request).receipt.message).toContain('手番');
  });
  it('参加者と観戦者へ未公開カード、山札、乱数、接続資格を配らない', () => {
    const t = fixture(); t.act({ type: 'start' });
    const session = t.restore();
    const observer = session.join('observer', '観戦者', false);
    for (const member of [session.data.members[0]!, observer]) {
      const snapshot = session.snapshot(member, t.online);
      for (const player of snapshot.state.players) {
        expect(player.holeCards.filter(Boolean)).toHaveLength(player.id === member.playerId ? 2 : 0);
      }
      expect(snapshot.state).not.toHaveProperty('deck');
      expect(snapshot.state).not.toHaveProperty('burned');
      for (const forbidden of ['"entropy":', '"tokenHash":', '"seed":']) {
        expect(JSON.stringify(snapshot)).not.toContain(forbidden);
      }
    }
  });
  it('同じ参加資格で再参加しても席や初期チップを増やさない', () => {
    const t = fixture();
    const resumed = t.restore(); resumed.join('host', '別名', true);
    expect(resumed.data.members).toHaveLength(3);
    expect(resumed.data.game.players.reduce((sum, player) => sum + player.chips, 0)).toBe(3000);
  });
  it('サイドポットの記録を保存する', () => {
    const t = fixture();
    t.data.game = { ...t.data.game, players: t.data.game.players.map((player, index) => ({ ...player, chips: [100, 200, 300][index]! })) };
    t.act({ type: 'start' });
    for (let i = 0; t.data.game.phase !== 'showdown' && i < 10; i++) {
      const playerId = t.data.game.turnPlayerId!;
      const legal = legalActions(t.data.game, playerId)!;
      const index = t.data.members.findIndex(member => member.playerId === playerId);
      const action = legal.canRaise ? { type: 'raise' as const, to: legal.maxRaiseTo } : { type: legal.canCheck ? 'check' as const : 'call' as const };
      const result = t.act(action, index);
      expect(result.receipt.ok).toBe(true);
      if (result.next.data.game.phase === 'showdown') expect(result.next.archives.size).toBe(1);
    }
    expect(t.data.game.players.reduce((sum, player) => sum + player.chips, 0)).toBe(600);
  });
  it('同点の配当を再接続しても保持する', () => {
    const t = fixture();
    t.data.game = { ...t.data.game, variant: { ...STANDARD_VARIANT,
      deck: { ...STANDARD_VARIANT.deck, ranks: ['A'], copies: 8 },
      ranking: { hands: [STANDARD_VARIANT.ranking.hands.at(-1)!] } } };
    t.act({ type: 'start' });
    while (t.data.game.phase !== 'showdown') t.call();
    expect(t.data.game.summary?.payouts).toHaveLength(3);
    expect(t.restore().data.game.players.map(player => player.chips)).toEqual([1000, 1000, 1000]);
  });
});

describe('入力の制約', () => {
  it('内部用操作や playerId の指定を拒否する', () => {
    const base = { type: 'command', id: 'request-1', seq: 1, handId: 1, turnId: 1 };
    for (const command of [{ type: 'timeout' }, { type: 'startHand', seed: 1 }, { type: 'sit', chips: 1000 },
      { type: 'fold', playerId: 'other' }, { type: 'raise', to: Infinity }]) expect(parseCommand({ ...base, command })).toBeNull();
  });
  it('人数とチップを制限し、成立しないルールを開始前に拒否する', () => {
    expect(() => readOptions({ ...options, seatCount: 11 })).toThrow();
    expect(() => readOptions({ ...options, chips: Number.MAX_SAFE_INTEGER })).toThrow();
    expect(() => readOptions({ ...options, variant: {} })).toThrow();
    expect(readOptions(options)).toEqual(options);
  });
});
