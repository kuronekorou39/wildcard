import { describe, expect, it } from 'vitest';
import { createGame, legalActions, reduce, validate } from '../src/game/reduce.js';
import type { Action, GameState } from '../src/types.js';

const SB = 10;
const BB = 20;

/** 指定した席にプレイヤーを座らせた卓を作る。id は p0, p1, ... */
function tableOf(seats: readonly number[], chips = 1000, dealerSeat = 0): GameState {
  let state = createGame({ seatCount: 10, smallBlind: SB, bigBlind: BB, dealerSeat });
  seats.forEach((seat, i) => {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat, chips });
  });
  return state;
}

const player = (state: GameState, id: string) => {
  const found = state.players.find((p) => p.id === id);
  if (!found) throw new Error(`プレイヤーが見つからない: ${id}`);
  return found;
};

const totalChips = (state: GameState) =>
  state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;

const run = (state: GameState, actions: readonly Action[]) => actions.reduce(reduce, state);

describe('着席と離席', () => {
  it('着席すると席が埋まる', () => {
    const state = tableOf([0, 1]);
    expect(state.players).toHaveLength(2);
    expect(player(state, 'p0').seat).toBe(0);
  });

  it('埋まっている席には座れない', () => {
    const state = tableOf([0, 1]);
    const rejected = reduce(state, { type: 'sit', playerId: 'x', name: 'x', seat: 0, chips: 1000 });
    expect(rejected).toBe(state);
    expect(validate(state, { type: 'sit', playerId: 'x', name: 'x', seat: 0, chips: 1000 })).toEqual({
      reason: 'その席は空いていない',
    });
  });

  it('範囲外の席番号は拒否される', () => {
    const state = tableOf([0]);
    expect(validate(state, { type: 'sit', playerId: 'x', name: 'x', seat: 10, chips: 100 })).toEqual({
      reason: '席番号が範囲外',
    });
  });

  it('ハンドに参加していなければその場で席が空く', () => {
    const state = tableOf([0, 1]);
    const left = reduce(state, { type: 'leave', playerId: 'p0' });
    expect(left.players).toHaveLength(1);
  });

  it('2人未満ではハンドを開始できない', () => {
    const state = tableOf([0]);
    expect(validate(state, { type: 'startHand', seed: 1 })).toEqual({ reason: '参加者が2人未満' });
  });
});

describe('ハンドの開始', () => {
  it('3人ならSBはディーラーの次、BBはその次、手番はBBの次', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });

    expect(state.phase).toBe('preflop');
    expect(state.dealerSeat).toBe(0);
    expect(player(state, 'p1').bet).toBe(SB);
    expect(player(state, 'p2').bet).toBe(BB);
    expect(state.pot).toBe(SB + BB);
    expect(state.currentBet).toBe(BB);
    expect(state.turnPlayerId).toBe('p0');
  });

  it('ヘッズアップではディーラーがSBを出し、ディーラーから始まる', () => {
    const state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });

    expect(player(state, 'p0').bet).toBe(SB);
    expect(player(state, 'p1').bet).toBe(BB);
    expect(state.turnPlayerId).toBe('p0');
  });

  it('全員に2枚配られる', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 7 });
    for (const p of state.players) {
      expect(p.holeCards).toHaveLength(2);
      expect(p.inHand).toBe(true);
    }
    expect(state.deck).toHaveLength(52 - 6);
  });

  it('配られたカードに重複がない', () => {
    const state = reduce(tableOf([0, 1, 2, 3, 4, 5]), { type: 'startHand', seed: 3 });
    const dealt = state.players.flatMap((p) => p.holeCards).map((c) => `${c.rank}${c.suit}`);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it('同じ seed からは同じ配牌になる', () => {
    const a = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 42 });
    const b = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 42 });
    expect(a.players.map((p) => p.holeCards)).toEqual(b.players.map((p) => p.holeCards));
  });

  it('2回目のハンドではボタンが時計回りに動く', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(state.dealerSeat).toBe(0);

    // p0 がフォールド、p1 がフォールドして決着させる
    state = run(state, [
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    ]);
    expect(state.phase).toBe('showdown');

    state = reduce(state, { type: 'startHand', seed: 2 });
    expect(state.dealerSeat).toBe(1);
  });

  it('ハンドの進行中は開始できない', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(validate(state, { type: 'startHand', seed: 2 })).toEqual({ reason: 'ハンドの進行中' });
  });
});

describe('ベッティングラウンド', () => {
  it('手番が時計回りに回る', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(state.turnPlayerId).toBe('p0');
    state = reduce(state, { type: 'call', playerId: 'p0' });
    expect(state.turnPlayerId).toBe('p1');
    state = reduce(state, { type: 'call', playerId: 'p1' });
    expect(state.turnPlayerId).toBe('p2');
  });

  it('手番ではないプレイヤーの行動は拒否される', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(reduce(state, { type: 'fold', playerId: 'p1' })).toBe(state);
    expect(validate(state, { type: 'fold', playerId: 'p1' })).toEqual({ reason: '手番ではない' });
  });

  it('コール額が足りないときチェックはできない', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(legalActions(state, 'p0')?.canCheck).toBe(false);
    expect(validate(state, { type: 'check', playerId: 'p0' })).toEqual({
      reason: 'チェックできない',
    });
  });

  it('ビッグブラインドは全員コールしても最後にレイズできる（BBオプション）', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
    ]);
    // 額は揃っているが BB はまだ行動していないのでラウンドは閉じない
    expect(state.phase).toBe('preflop');
    expect(state.turnPlayerId).toBe('p2');
    expect(legalActions(state, 'p2')?.canCheck).toBe(true);
    expect(legalActions(state, 'p2')?.canRaise).toBe(true);
  });

  it('BBがチェックするとフロップへ進む', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ]);

    expect(state.phase).toBe('flop');
    expect(state.communityCards).toHaveLength(3);
    expect(state.currentBet).toBe(0);
    expect(state.players.every((p) => p.bet === 0)).toBe(true);
    // フロップ以降はディーラーの次（席1）から
    expect(state.turnPlayerId).toBe('p1');
  });

  it('レイズが入ると他のプレイヤーはもう一度行動しなければならない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'raise', playerId: 'p2', to: 60 },
    ]);

    expect(state.phase).toBe('preflop');
    expect(state.currentBet).toBe(60);
    expect(player(state, 'p0').hasActed).toBe(false);
    expect(player(state, 'p1').hasActed).toBe(false);
    expect(state.turnPlayerId).toBe('p0');
  });

  it('レイズ額の下限を下回ると拒否される', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    // currentBet 20 + minRaise 20 = 40 が下限
    expect(legalActions(state, 'p0')?.minRaiseTo).toBe(40);
    expect(validate(state, { type: 'raise', playerId: 'p0', to: 30 })).toEqual({
      reason: 'レイズ額が下限未満',
    });
    expect(validate(state, { type: 'raise', playerId: 'p0', to: 40 })).toBeNull();
  });

  it('手持ちを超えるレイズは拒否される', () => {
    const state = reduce(tableOf([0, 1, 2], 100), { type: 'startHand', seed: 1 });
    expect(legalActions(state, 'p0')?.maxRaiseTo).toBe(100);
    expect(validate(state, { type: 'raise', playerId: 'p0', to: 101 })).toEqual({
      reason: '手持ちを超えている',
    });
  });

  it('リバーまで進んでショーダウンに至る', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 11 });
    // プリフロップ: SB(p0) がコール、BB(p1) がチェック
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'check', playerId: 'p1' },
    ]);
    expect(state.phase).toBe('flop');

    for (const phase of ['turn', 'river'] as const) {
      state = run(state, [
        { type: 'check', playerId: state.turnPlayerId! },
        { type: 'check', playerId: state.turnPlayerId === 'p0' ? 'p1' : 'p0' },
      ]);
      expect(state.phase).toBe(phase);
    }

    expect(state.communityCards).toHaveLength(5);
    state = run(state, [
      { type: 'check', playerId: state.turnPlayerId! },
      { type: 'check', playerId: state.turnPlayerId === 'p0' ? 'p1' : 'p0' },
    ]);

    expect(state.phase).toBe('showdown');
    expect(state.summary?.revealed).toHaveLength(2);
  });
});

describe('フォールドによる決着', () => {
  it('1人だけ残ればその場で決着し、手は公開されない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    const potBefore = state.pot;

    state = run(state, [
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    ]);

    expect(state.phase).toBe('showdown');
    expect(state.summary?.revealed).toEqual([]);
    expect(state.summary?.payouts).toEqual([{ playerId: 'p2', amount: potBefore }]);
    // BB として出した 20 が戻り、SB の 10 が利益
    expect(player(state, 'p2').chips).toBe(1000 + SB);
    expect(state.pot).toBe(0);
  });

  it('決着してもチップの総量は変わらない', () => {
    const start = tableOf([0, 1, 2]);
    const before = totalChips(start);
    const state = run(reduce(start, { type: 'startHand', seed: 5 }), [
      { type: 'fold', playerId: 'p0' },
      { type: 'raise', playerId: 'p1', to: 100 },
      { type: 'fold', playerId: 'p2' },
    ]);
    expect(state.phase).toBe('showdown');
    expect(totalChips(state)).toBe(before);
  });
});

describe('時間切れ', () => {
  it('払う必要があるならフォールドになる', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    const after = reduce(state, { type: 'timeout', playerId: 'p0' });
    expect(player(after, 'p0').folded).toBe(true);
  });

  it('払う必要がなければチェックになる', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
    ]);
    // BB は払う必要がない
    const after = reduce(state, { type: 'timeout', playerId: 'p2' });
    expect(player(after, 'p2').folded).toBe(false);
    expect(after.phase).toBe('flop');
  });
});

describe('ハンド途中の着席（waiting）', () => {
  it('進行中に座った人は現在のハンドに混ざらない', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'sit', playerId: 'late', name: 'late', seat: 5, chips: 1000 });

    expect(player(state, 'late').waiting).toBe(true);
    expect(player(state, 'late').inHand).toBe(false);
    expect(player(state, 'late').holeCards).toEqual([]);
  });

  it('途中参加者に手番が回ってこない', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'sit', playerId: 'late', name: 'late', seat: 5, chips: 1000 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'check', playerId: 'p1' },
    ]);
    expect(state.phase).toBe('flop');
    expect(state.turnPlayerId).not.toBe('late');
  });

  it('次のハンドからは参加する', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'sit', playerId: 'late', name: 'late', seat: 5, chips: 1000 });
    state = run(state, [
      { type: 'fold', playerId: 'p0' },
    ]);
    expect(state.phase).toBe('showdown');

    state = reduce(state, { type: 'startHand', seed: 2 });
    expect(player(state, 'late').waiting).toBe(false);
    expect(player(state, 'late').inHand).toBe(true);
    expect(player(state, 'late').holeCards).toHaveLength(2);
  });

  it('ショーダウン中に座った人は次のハンドに参加できる', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'fold', playerId: 'p0' });
    expect(state.phase).toBe('showdown');

    state = reduce(state, { type: 'sit', playerId: 'late', name: 'late', seat: 5, chips: 1000 });
    expect(player(state, 'late').waiting).toBe(false);
  });
});

describe('離席（away）', () => {
  it('自分の手番で離席すると自動フォールドされ、進行が止まらない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(state.turnPlayerId).toBe('p0');

    state = reduce(state, { type: 'setAway', playerId: 'p0', away: true });

    expect(player(state, 'p0').folded).toBe(true);
    expect(player(state, 'p0').away).toBe(true);
    expect(state.turnPlayerId).toBe('p1');
  });

  it('手番でない離席ではフォールドされない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'setAway', playerId: 'p1', away: true });

    expect(player(state, 'p1').away).toBe(true);
    expect(player(state, 'p1').folded).toBe(false);
    expect(state.turnPlayerId).toBe('p0');
  });

  it('離席者は次のハンドに参加しない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'setAway', playerId: 'p1', away: true });
    state = run(state, [
      { type: 'fold', playerId: 'p0' },
    ]);
    expect(state.phase).toBe('showdown');

    state = reduce(state, { type: 'startHand', seed: 2 });
    expect(player(state, 'p1').inHand).toBe(false);
    expect(player(state, 'p2').inHand).toBe(true);
  });

  it('復帰すれば次のハンドから参加する', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'setAway', playerId: 'p1', away: true });
    state = reduce(state, { type: 'fold', playerId: 'p0' });
    state = reduce(state, { type: 'setAway', playerId: 'p1', away: false });
    state = reduce(state, { type: 'startHand', seed: 2 });

    expect(player(state, 'p1').inHand).toBe(true);
  });
});

describe('ハンド途中の退席（leaving）', () => {
  it('参加中に退席するとフォールド扱いで席に残る', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'leave', playerId: 'p1' });

    expect(state.players).toHaveLength(3);
    expect(player(state, 'p1').folded).toBe(true);
    expect(player(state, 'p1').leaving).toBe(true);
    // SB として出した 10 はポットに残っている
    expect(player(state, 'p1').committed).toBe(SB);
    expect(state.pot).toBe(SB + BB);
  });

  it('次のハンド開始時に実際に席から消える', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = reduce(state, { type: 'leave', playerId: 'p1' });
    state = run(state, [
      { type: 'fold', playerId: 'p0' },
    ]);
    expect(state.phase).toBe('showdown');

    state = reduce(state, { type: 'startHand', seed: 2 });
    expect(state.players.map((p) => p.id)).toEqual(['p0', 'p2']);
  });

  it('手番の人が退席しても進行が止まらない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(state.turnPlayerId).toBe('p0');
    state = reduce(state, { type: 'leave', playerId: 'p0' });
    expect(state.turnPlayerId).toBe('p1');
  });
});

describe('オールイン', () => {
  it('コールしきれなければオールインになる', () => {
    let state = reduce(tableOf([0, 1], 100), { type: 'startHand', seed: 1 });
    // p0(SB) がオールインまでレイズ、p1 がコール
    state = reduce(state, { type: 'raise', playerId: 'p0', to: 100 });
    expect(player(state, 'p0').allIn).toBe(true);
    expect(player(state, 'p0').chips).toBe(0);
  });

  it('全員オールインならボードを配り切ってショーダウンまで進む', () => {
    let state = reduce(tableOf([0, 1], 100), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'raise', playerId: 'p0', to: 100 },
      { type: 'call', playerId: 'p1' },
    ]);

    expect(state.phase).toBe('showdown');
    expect(state.communityCards).toHaveLength(5);
    expect(state.summary?.revealed).toHaveLength(2);
    expect(state.turnPlayerId).toBeNull();
  });

  it('オールイン決着でもチップの総量は変わらない', () => {
    const start = tableOf([0, 1], 100);
    const before = totalChips(start);
    const state = run(reduce(start, { type: 'startHand', seed: 9 }), [
      { type: 'raise', playerId: 'p0', to: 100 },
      { type: 'call', playerId: 'p1' },
    ]);
    expect(totalChips(state)).toBe(before);
  });

  it('コールされなかった分は戻ってくる', () => {
    // p0 は 1000 持ち、p1 は 100 持ち。p0 が 500 までレイズしても
    // p1 は 100 しか出せないので、差額は p0 に戻る。
    let state = createGame({ seatCount: 10, smallBlind: SB, bigBlind: BB, dealerSeat: 0 });
    state = reduce(state, { type: 'sit', playerId: 'p0', name: 'p0', seat: 0, chips: 1000 });
    state = reduce(state, { type: 'sit', playerId: 'p1', name: 'p1', seat: 1, chips: 100 });
    const before = totalChips(state);

    state = run(reduce(state, { type: 'startHand', seed: 4 }), [
      { type: 'raise', playerId: 'p0', to: 500 },
      { type: 'call', playerId: 'p1' },
    ]);

    expect(state.phase).toBe('showdown');
    expect(totalChips(state)).toBe(before);
    // 取り合われたのは 100 ずつの計 200 だけ
    const won = state.summary!.payouts.reduce((sum, p) => sum + p.amount, 0);
    expect(won).toBe(200 + 400);
  });
});
