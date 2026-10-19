import { describe, expect, it } from 'vitest';
import { createGame, legalActions, reduce } from '../src/game/reduce.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import type { Action, BettingRules, GameState, Variant } from '../src/types.js';

/**
 * 賭け方の制度。
 *
 * **判断はすべて legalActions に集約する。** UI が上限を自前で計算し直すと
 * 必ずどこかでエンジンと食い違う。ここで見ているのは「何が押せて、
 * いくらまで出せるか」であり、画面はその結果を表示するだけでよい。
 */

const withBetting = (betting: BettingRules): Variant => ({ ...STANDARD_VARIANT, betting });

function tableOf(count: number, variant: Variant, chips = 1000): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
  for (let i = 0; i < count; i++) {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips });
  }
  return state;
}

const started = (variant: Variant, count = 3, chips = 1000, seed = 1): GameState =>
  reduce(tableOf(count, variant, chips), { type: 'startHand', seed });

const legalFor = (state: GameState) => legalActions(state, state.turnPlayerId!)!;

/** 手番の人にそのまま打たせる。 */
const act = (
  state: GameState,
  action: { readonly type: 'fold' | 'check' | 'call' } | { readonly type: 'raise'; readonly to: number },
): GameState => reduce(state, { ...action, playerId: state.turnPlayerId! } as Action);

describe('ノーリミット', () => {
  it('手持ち全部まで出せる', () => {
    const state = started(withBetting({ limit: 'no-limit' }));
    const legal = legalFor(state);
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    expect(legal.maxRaiseTo).toBe(me.bet + me.chips);
  });
});

describe('ポットリミット', () => {
  it('コールしたあとのポットぶんまで', () => {
    // SB10 + BB20 = 30。UTG はコール20してポット50、そこから50上乗せ → 70。
    const state = started(withBetting({ limit: 'pot-limit' }));
    expect(state.pot).toBe(30);
    expect(legalFor(state).maxRaiseTo).toBe(70);
  });

  it('コール額を足し忘れない', () => {
    // currentBet + pot だけだと 50 になる。よくある間違い。
    const state = started(withBetting({ limit: 'pot-limit' }));
    expect(legalFor(state).maxRaiseTo).not.toBe(50);
  });

  it('ポットが育つと上限も上がる', () => {
    let state = started(withBetting({ limit: 'pot-limit' }));
    const first = legalFor(state).maxRaiseTo;
    state = act(state, { type: 'raise', to: first });
    expect(legalFor(state).maxRaiseTo).toBeGreaterThan(first);
  });

  it('手持ちを超えては出せない', () => {
    const state = started(withBetting({ limit: 'pot-limit' }), 3, 50);
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    expect(legalFor(state).maxRaiseTo).toBe(me.bet + me.chips);
  });

  it('上限を超えるレイズは弾かれる', () => {
    const state = started(withBetting({ limit: 'pot-limit' }));
    const over = legalFor(state).maxRaiseTo + 1;
    expect(act(state, { type: 'raise', to: over })).toBe(state);
  });
});

describe('フィックスリミット', () => {
  const limit: BettingRules = { limit: 'fixed-limit', bigBetFrom: 1, maxRaisesPerRound: 4 };

  it('刻みが決まっていて、下限と上限が同じ', () => {
    const state = started(withBetting(limit));
    const legal = legalFor(state);
    // プリフロップは BB ぶん。currentBet 20 + 20 = 40 ちょうど。
    expect(legal.minRaiseTo).toBe(40);
    expect(legal.maxRaiseTo).toBe(40);
  });

  it('途中の額にはできない', () => {
    const state = started(withBetting(limit));
    expect(act(state, { type: 'raise', to: 35 })).toBe(state);
    expect(act(state, { type: 'raise', to: 100 })).toBe(state);
  });

  it('指定したストリートから倍になる', () => {
    let state = started(withBetting(limit));
    // プリフロップを全員コールしてフロップへ。
    for (let i = 0; i < 3; i++) state = act(state, { type: 'call' });
    expect(state.streetIndex).toBe(0);
    // フロップ（index 0）はまだ小さい賭け。
    expect(legalFor(state).maxRaiseTo).toBe(20);

    for (let i = 0; i < 3; i++) state = act(state, { type: 'check' });
    expect(state.streetIndex).toBe(1);
    // ターン（index 1）から倍。
    expect(legalFor(state).maxRaiseTo).toBe(40);
  });

  it('倍になる段階を決めなければ倍にならない', () => {
    let state = started(withBetting({ limit: 'fixed-limit' }));
    for (let i = 0; i < 3; i++) state = act(state, { type: 'call' });
    for (let i = 0; i < 3; i++) state = act(state, { type: 'check' });
    expect(state.streetIndex).toBe(1);
    expect(legalFor(state).maxRaiseTo).toBe(20);
  });

  it('手持ちが足りなければオールインで出せる', () => {
    // 刻みに届かなくても、全部出すなら認める（ショートオールイン）。
    const state = started(withBetting(limit), 3, 25);
    const legal = legalFor(state);
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    expect(legal.maxRaiseTo).toBe(me.bet + me.chips);
    expect(legal.minRaiseTo).toBe(legal.maxRaiseTo);
  });
});

describe('レイズ回数の上限', () => {
  it('上限に達するとレイズできなくなる', () => {
    let state = started(withBetting({ limit: 'no-limit', maxRaisesPerRound: 2 }));
    expect(legalFor(state).canRaise).toBe(true);

    state = act(state, { type: 'raise', to: 40 });
    expect(state.raisesThisRound).toBe(1);
    expect(legalFor(state).canRaise).toBe(true);

    state = act(state, { type: 'raise', to: 80 });
    expect(state.raisesThisRound).toBe(2);
    const legal = legalFor(state);
    expect(legal.canRaise).toBe(false);
    // 降りるかコールするかは選べる。
    expect(legal.canCall).toBe(true);
    expect(legal.canFold).toBe(true);
  });

  it('上限を超えるレイズは弾かれる', () => {
    let state = started(withBetting({ limit: 'no-limit', maxRaisesPerRound: 1 }));
    state = act(state, { type: 'raise', to: 40 });
    expect(act(state, { type: 'raise', to: 80 })).toBe(state);
  });

  it('ストリートが変わると数え直す', () => {
    let state = started(withBetting({ limit: 'no-limit', maxRaisesPerRound: 1 }));
    state = act(state, { type: 'raise', to: 40 });
    for (let i = 0; i < 3; i++) state = act(state, { type: 'call' });
    expect(state.streetIndex).toBe(0);
    expect(state.raisesThisRound).toBe(0);
    expect(legalFor(state).canRaise).toBe(true);
  });

  it('指定しなければ無制限', () => {
    let state = started(withBetting({ limit: 'no-limit' }));
    for (let i = 0; i < 5; i++) {
      state = act(state, { type: 'raise', to: state.currentBet + 20 });
    }
    expect(legalFor(state).canRaise).toBe(true);
  });
});

describe('ストリートごとの上限', () => {
  const noAllInPreflop: BettingRules = {
    limit: 'no-limit',
    streetCaps: [{ street: -1, noAllIn: true }],
  };

  it('プリフロップでオールインできない', () => {
    const state = started(withBetting(noAllInPreflop));
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    // 最低1枚は残る。
    expect(legalFor(state).maxRaiseTo).toBe(me.bet + me.chips - 1);
  });

  it('全部出そうとすると弾かれる', () => {
    const state = started(withBetting(noAllInPreflop));
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    expect(act(state, { type: 'raise', to: me.bet + me.chips })).toBe(state);
  });

  it('コールは縛らない（コールでオールインになってもよい）', () => {
    // コールまで縛ると、相手のベットに応じられない人が出て勝負が進まない。
    // 手持ちの少ない人を混ぜて、コールがそのままオールインになる形を作る。
    let state = createGame({
      seatCount: 10,
      smallBlind: 10,
      bigBlind: 20,
      variant: withBetting(noAllInPreflop),
    });
    for (const [i, chips] of [1000, 1000, 200].entries()) {
      state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips });
    }
    state = reduce(state, { type: 'startHand', seed: 1 });

    // UTG が（オールインにならない範囲で）大きくレイズする。
    const big = state.players.find((p) => p.id === state.turnPlayerId)!;
    state = act(state, { type: 'raise', to: big.bet + big.chips - 1 });

    // 手持ちの少ない人の番まで進める。
    while (state.phase === 'betting' && state.players.find((p) => p.id === state.turnPlayerId)!.chips > 500) {
      state = act(state, { type: 'fold' });
    }

    const short = state.players.find((p) => p.id === state.turnPlayerId)!;
    const legal = legalFor(state);
    expect(legal.canCall).toBe(true);
    // 手持ち全部を出すコール。オールイン禁止はレイズだけの縛り。
    expect(legal.callAmount).toBe(short.chips);

    // 実際に受け付けられる（弾かれて同じ state が返ってこない）。
    const after = act(state, { type: 'call' });
    expect(after).not.toBe(state);
    expect(after.players.find((p) => p.id === short.id)!.chips).not.toBe(short.chips);
  });

  it('次のストリートでは外れる', () => {
    let state = started(withBetting(noAllInPreflop));
    for (let i = 0; i < 3; i++) state = act(state, { type: 'call' });
    expect(state.streetIndex).toBe(0);
    const me = state.players.find((p) => p.id === state.turnPlayerId)!;
    expect(legalFor(state).maxRaiseTo).toBe(me.bet + me.chips);
  });

  it('額の上限も掛けられる', () => {
    const capped: BettingRules = {
      limit: 'no-limit',
      streetCaps: [{ street: -1, maxTotal: 100 }],
    };
    const state = started(withBetting(capped));
    expect(legalFor(state).maxRaiseTo).toBe(100);
  });
});

describe('ストラドル', () => {
  const straddle: BettingRules = { limit: 'no-limit', straddle: { max: 2 } };

  it('出す意思がなければ何も起きない', () => {
    const state = started(withBetting(straddle));
    expect(state.currentBet).toBe(20);
  });

  it('出すと賭け金が倍になる', () => {
    let state = tableOf(3, withBetting(straddle));
    // 3人なら UTG はディーラー（seat0）。BB の次。
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    state = reduce(state, { type: 'startHand', seed: 1 });

    expect(state.currentBet).toBe(40);
    expect(state.players.find((p) => p.id === 'p0')!.bet).toBe(40);
  });

  it('出した人が最後に行動する', () => {
    // 順番が変わることがストラドルの本質。額が倍になるのはその結果。
    let state = tableOf(3, withBetting(straddle));
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    state = reduce(state, { type: 'startHand', seed: 1 });

    // UTG(p0) が出したので、最初に行動するのはその次。
    expect(state.turnPlayerId).not.toBe('p0');

    const order: string[] = [];
    for (let i = 0; i < 3 && state.phase === 'betting'; i++) {
      order.push(state.turnPlayerId!);
      state = act(state, { type: 'call' });
    }
    expect(order[order.length - 1]).toBe('p0');
  });

  it('重ねられる', () => {
    let state = tableOf(4, withBetting(straddle));
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    state = reduce(state, { type: 'setStraddle', playerId: 'p1', on: true });
    state = reduce(state, { type: 'startHand', seed: 1 });

    // 4人: dealer=p0, SB=p1, BB=p2, UTG=p3。意思があるのは p0 と p1 だが、
    // UTG は p3 なので誰も出さない。
    expect(state.currentBet).toBe(20);
  });

  it('上限まで重なる', () => {
    let state = tableOf(4, withBetting(straddle));
    // dealer=p0, SB=p1, BB=p2, UTG=p3, その次は p0。
    state = reduce(state, { type: 'setStraddle', playerId: 'p3', on: true });
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    state = reduce(state, { type: 'startHand', seed: 1 });

    expect(state.players.find((p) => p.id === 'p3')!.bet).toBe(40);
    expect(state.players.find((p) => p.id === 'p0')!.bet).toBe(80);
    expect(state.currentBet).toBe(80);
    // 上限2回なので3人目には回らない。
    expect(state.turnPlayerId).toBe('p1');
  });

  it('出した人ももう一度行動できる', () => {
    let state = tableOf(3, withBetting(straddle));
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    state = reduce(state, { type: 'startHand', seed: 1 });
    expect(state.players.find((p) => p.id === 'p0')!.hasActed).toBe(false);
  });

  it('許していない卓では設定できない', () => {
    const state = tableOf(3, withBetting({ limit: 'no-limit' }));
    expect(reduce(state, { type: 'setStraddle', playerId: 'p0', on: true })).toBe(state);
  });

  it('ハンドの途中で変えても、そのハンドには効かない', () => {
    // 配る前に決めるもの。途中で賭け金が変わるほうがおかしい。
    let state = started(withBetting(straddle));
    const before = state.currentBet;
    state = reduce(state, { type: 'setStraddle', playerId: 'p0', on: true });
    expect(state.currentBet).toBe(before);
    expect(state.players.find((p) => p.id === 'p0')!.straddleOn).toBe(true);
  });
});
