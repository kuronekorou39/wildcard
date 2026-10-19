import { describe, expect, it } from 'vitest';
import { boardsOf, createGame, reduce } from '../src/game/reduce.js';
import { cardKey } from '../src/deck.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { extraCardsFor, requiredCards } from '../src/variant.js';
import type { Action, GameState, Variant } from '../src/types.js';

/**
 * ランイットトゥワイス。
 *
 * オールインで決着するとき、残りの札を複数回走らせてポットを分ける。
 * 勝ち負けの分散が下がるので、大きなポットほど持ちかけられる。
 *
 * **全員の同意が要る**のが肝で、1人でも断れば1本になる。実際の卓の作法どおり。
 */

const twiceVariant = (max = 2): Variant => ({
  ...STANDARD_VARIANT,
  options: { ...STANDARD_VARIANT.options, runItTwice: { max } },
});

function tableOf(count: number, variant: Variant, chips = 1000): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
  for (let i = 0; i < count; i++) {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips });
  }
  return state;
}

/** 全員オールインにして、札をめくるだけの場面まで進める。 */
function allInHeadsUp(variant: Variant, chips = 1000, seed = 7): GameState {
  let state = tableOf(2, variant, chips);
  state = reduce(state, { type: 'startHand', seed });

  // ヘッズアップのプリフロップはディーラー（SB）から。
  // 片方がオールインし、もう片方がコールすれば、あとは開くだけ。
  for (let i = 0; i < 6 && state.phase === 'betting'; i++) {
    const turn = state.turnPlayerId;
    if (!turn) break;
    const player = state.players.find((p) => p.id === turn)!;
    const action: Action =
      state.currentBet > player.bet && player.bet > 0
        ? { type: 'call', playerId: turn }
        : { type: 'raise', playerId: turn, to: player.bet + player.chips };
    const next = reduce(state, action);
    if (next === state) break;
    state = next;
  }
  return state;
}

const total = (state: GameState) => state.players.reduce((sum, p) => sum + p.chips, 0);

describe('聞く場面', () => {
  it('有効にしていなければ聞かない', () => {
    const state = allInHeadsUp(STANDARD_VARIANT);
    expect(state.phase).toBe('showdown');
    expect(state.runChoice).toBeNull();
    expect(boardsOf(state)).toHaveLength(1);
  });

  it('全員オールインで札が残っていれば聞く', () => {
    const state = allInHeadsUp(twiceVariant());
    expect(state.phase).toBe('runChoice');
    expect(state.runChoice?.pending).toHaveLength(2);
    expect(state.turnPlayerId).toBe(state.runChoice?.pending[0]);
    // 聞いている間はまだ開かない。
    expect(state.communityCards).toHaveLength(0);
  });

  it('席順に聞く', () => {
    const state = allInHeadsUp(twiceVariant());
    const seats = state.runChoice!.pending.map(
      (id) => state.players.find((p) => p.id === id)!.seat,
    );
    // ディーラーの次から時計回り。誰から聞いたかで結果が変わって見えないように。
    expect(seats[0]).toBe((state.dealerSeat + 1) % state.seatCount);
  });

  it('ベッティングが続くうちは聞かない', () => {
    let state = tableOf(3, twiceVariant());
    state = reduce(state, { type: 'startHand', seed: 3 });
    // 全員コールしただけ。まだ誰もオールインしていない。
    for (let i = 0; i < 3; i++) {
      const turn = state.turnPlayerId;
      if (turn) state = reduce(state, { type: 'call', playerId: turn });
    }
    expect(state.phase).toBe('betting');
    expect(state.communityCards.length).toBeGreaterThan(0);
  });

  it('降りて1人になったら聞かない', () => {
    let state = tableOf(2, twiceVariant());
    state = reduce(state, { type: 'startHand', seed: 5 });
    state = reduce(state, { type: 'fold', playerId: state.turnPlayerId! });
    expect(state.phase).toBe('showdown');
    expect(boardsOf(state)).toHaveLength(1);
  });

  it('開く札が残っていなければ聞かない', () => {
    // リバーまで開いてからのオールインには、走らせる先が無い。
    const noStreets: Variant = {
      ...twiceVariant(),
      structure: { ...STANDARD_VARIANT.structure, streets: [] },
    };
    const state = allInHeadsUp(noStreets);
    expect(state.phase).toBe('showdown');
  });
});

describe('合意', () => {
  it('全員が同意すると2本走る', () => {
    let state = allInHeadsUp(twiceVariant());
    const asked = [...state.runChoice!.pending];
    for (const id of asked) state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });

    expect(state.phase).toBe('showdown');
    const boards = boardsOf(state);
    expect(boards).toHaveLength(2);
    for (const board of boards) expect(board).toHaveLength(5);
  });

  it('1人でも断れば1本', () => {
    let state = allInHeadsUp(twiceVariant());
    const [first, second] = state.runChoice!.pending;
    state = reduce(state, { type: 'runItTwice', playerId: first!, agree: true });
    expect(state.phase).toBe('runChoice');
    expect(state.turnPlayerId).toBe(second);

    state = reduce(state, { type: 'runItTwice', playerId: second!, agree: false });
    expect(state.phase).toBe('showdown');
    expect(boardsOf(state)).toHaveLength(1);
  });

  it('最初の1人が断れば、残りには聞かない', () => {
    let state = allInHeadsUp(twiceVariant());
    state = reduce(state, {
      type: 'runItTwice',
      playerId: state.runChoice!.pending[0]!,
      agree: false,
    });
    expect(state.phase).toBe('showdown');
    expect(boardsOf(state)).toHaveLength(1);
  });

  it('時間切れは「断った」こと', () => {
    // 返事が無いまま2本走らせると、同意していない人の金が動く。
    let state = allInHeadsUp(twiceVariant());
    state = reduce(state, { type: 'timeout', playerId: state.turnPlayerId! });
    expect(state.phase).toBe('showdown');
    expect(boardsOf(state)).toHaveLength(1);
  });

  it('手番でない人は答えられない', () => {
    const state = allInHeadsUp(twiceVariant());
    const other = state.runChoice!.pending[1]!;
    expect(reduce(state, { type: 'runItTwice', playerId: other, agree: false })).toBe(state);
  });

  it('聞いていないときには答えられない', () => {
    let state = tableOf(2, twiceVariant());
    state = reduce(state, { type: 'startHand', seed: 9 });
    expect(reduce(state, { type: 'runItTwice', playerId: 'p0', agree: true })).toBe(state);
  });

  it('3本も走れる', () => {
    let state = allInHeadsUp(twiceVariant(3));
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    expect(boardsOf(state)).toHaveLength(3);
  });
});

describe('配り方', () => {
  it('同じ札が2つのボードに出ない', () => {
    let state = allInHeadsUp(twiceVariant());
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    const all = boardsOf(state).flat().map(cardKey);
    expect(new Set(all).size).toBe(all.length);
  });

  it('手札ともぶつからない', () => {
    let state = allInHeadsUp(twiceVariant());
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    const all = [
      ...boardsOf(state).flat(),
      ...state.players.flatMap((p) => p.holeCards),
      ...state.burned,
    ].map(cardKey);
    expect(new Set(all).size).toBe(all.length);
  });

  it('すでに開いている札は共有する', () => {
    // フロップまで開いてからのオールインなら、変わるのはターンとリバーだけ。
    let state = tableOf(2, twiceVariant(), 1000);
    state = reduce(state, { type: 'startHand', seed: 11 });
    state = reduce(state, { type: 'call', playerId: state.turnPlayerId! });
    state = reduce(state, { type: 'check', playerId: state.turnPlayerId! });
    expect(state.communityCards).toHaveLength(3);
    const flop = state.communityCards.map(cardKey);

    // フロップでオールイン → コール
    const actor = state.players.find((p) => p.id === state.turnPlayerId)!;
    state = reduce(state, {
      type: 'raise',
      playerId: actor.id,
      to: actor.bet + actor.chips,
    });
    state = reduce(state, { type: 'call', playerId: state.turnPlayerId! });

    expect(state.phase).toBe('runChoice');
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }

    const boards = boardsOf(state);
    expect(boards).toHaveLength(2);
    for (const board of boards) {
      expect(board.slice(0, 3).map(cardKey)).toEqual(flop);
      expect(board).toHaveLength(5);
    }
    // 変わるのは残りの2枚。
    expect(boards[0]!.slice(3).map(cardKey)).not.toEqual(boards[1]!.slice(3).map(cardKey));
  });

  it('必要なデッキ枚数に本数ぶんが入る', () => {
    const once = requiredCards(STANDARD_VARIANT.structure, 2, extraCardsFor(STANDARD_VARIANT));
    const twice = requiredCards(twiceVariant().structure, 2, extraCardsFor(twiceVariant()));
    // 場5枚＋バーン3枚ぶん多く要る。
    expect(twice - once).toBe(8);
  });
});

describe('ポットの分け方', () => {
  it('チップの総量が変わらない', () => {
    let state = allInHeadsUp(twiceVariant());
    const before = total(state) + state.pot;
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    expect(total(state)).toBe(before);
    expect(state.pot).toBe(0);
  });

  it('本数ぶんの内訳が残る', () => {
    let state = allInHeadsUp(twiceVariant());
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    const runs = state.summary!.runs!;
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.board).toHaveLength(5);
      expect(run.revealed.length).toBeGreaterThan(0);
    }
    // 走りごとの配当を足すと、合計の配当になる。
    const perRun = runs
      .flatMap((run) => run.payouts)
      .reduce((sum, payout) => sum + payout.amount, 0);
    const all = state.summary!.payouts.reduce((sum, payout) => sum + payout.amount, 0);
    expect(all).toBeGreaterThanOrEqual(perRun);
  });

  it('1本なら内訳を入れない', () => {
    // いつも配列にすると、読む側が常に [0] を書くことになる。
    let state = allInHeadsUp(twiceVariant());
    state = reduce(state, {
      type: 'runItTwice',
      playerId: state.turnPlayerId!,
      agree: false,
    });
    expect(state.summary!.runs).toBeUndefined();
  });

  it('端数は先の走りに乗る', () => {
    // 奇数のポットを2本で割ると、1本目が1枚多く取る。
    // ヘッズアップのポットは必ず偶数になる（同額を出し合うので）ため、3人で作る。
    let state = tableOf(3, twiceVariant(), 101);
    state = reduce(state, { type: 'startHand', seed: 13 });
    for (let i = 0; i < 8 && state.phase === 'betting'; i++) {
      const turn = state.turnPlayerId;
      if (!turn) break;
      const player = state.players.find((p) => p.id === turn)!;
      const next =
        state.currentBet > player.bet && player.bet > 0
          ? reduce(state, { type: 'call', playerId: turn })
          : reduce(state, { type: 'raise', playerId: turn, to: player.bet + player.chips });
      if (next === state) break;
      state = next;
    }
    const pot = state.pot;
    expect(pot).toBe(303);

    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    expect(total(state)).toBe(303);

    const runs = state.summary!.runs!;
    const amountOf = (i: number) => runs[i]!.payouts.reduce((sum, p) => sum + p.amount, 0);
    // 2本の合計がポット。端数は1本目に乗る。
    expect(amountOf(0) + amountOf(1)).toBe(pot);
    expect(amountOf(0) - amountOf(1)).toBe(1);
  });

  it('両方のボードで勝てば全部取る', () => {
    let state = allInHeadsUp(twiceVariant());
    const pot = state.pot;
    for (const id of [...state.runChoice!.pending]) {
      state = reduce(state, { type: 'runItTwice', playerId: id, agree: true });
    }
    const runs = state.summary!.runs!;
    const winners = runs.map((run) => run.payouts.map((p) => p.playerId).sort().join(','));

    if (winners[0] === winners[1] && !winners[0]!.includes(',')) {
      const winner = runs[0]!.payouts[0]!.playerId;
      const got = state.summary!.payouts.find((p) => p.playerId === winner)!;
      expect(got.amount).toBe(pot);
    }
  });
});
