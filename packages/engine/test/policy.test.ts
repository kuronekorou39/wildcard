import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, decide } from '../src/ai/policy.js';
import { createGame, legalActions, reduce, validate } from '../src/game/reduce.js';
import { VARIANT_PRESETS } from '../src/rules/variants.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { PREFLOP, type BettingRules, type GameState, type Variant } from '../src/types.js';

/**
 * 速さ優先の設定。
 *
 * decide の重さは「試行回数 × 相手の人数」で決まるので、対局を何十回も
 * 回すと一気に遅くなる。方策の筋（正当な行動を返すか、降りすぎないか）は
 * 勝率の精度に依らないので、ここでは試行を切り詰める。
 * 勝率そのものの正しさは equity.test.ts で別に見ている。
 */
const FAST = { ...DEFAULT_STYLE, samples: 12 };

function cpuTable(count: number, chips = 1000, variant?: Variant): GameState {
  let state = createGame({
    seatCount: 10,
    smallBlind: 10,
    bigBlind: 20,
    ...(variant ? { variant } : {}),
  });
  for (let i = 0; i < count; i++) {
    state = reduce(state, {
      type: 'sit',
      playerId: `cpu${i}`,
      name: `CPU${i}`,
      seat: i,
      chips,
    });
  }
  return state;
}

const totalChips = (state: GameState) =>
  state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;

/**
 * 判断を測るための局面を集める。
 *
 * CPU に進行させると局面1つあたり decide が1回走って高くつくので、
 * 収集は「チェックできればチェック、でなければコール」で進める。
 */
function collectStates(seeds: number, perHand: number): GameState[] {
  const collected: GameState[] = [];
  for (let seed = 0; seed < seeds; seed++) {
    let state = reduce(cpuTable(4), { type: 'startHand', seed });
    for (let step = 0; step < perHand && state.phase !== 'showdown'; step++) {
      collected.push(state);
      const id = state.turnPlayerId!;
      const legal = legalActions(state, id)!;
      state = reduce(state, legal.canCheck ? { type: 'check', playerId: id } : { type: 'call', playerId: id });
    }
  }
  return collected;
}

describe('CPU の一手', () => {
  it('手番でなければ何も返さない', () => {
    const state = reduce(cpuTable(3), { type: 'startHand', seed: 1 });
    const notTurn = state.players.find((p) => p.id !== state.turnPlayerId)!;
    expect(decide(state, notTurn.id, 1, FAST)).toBeNull();
  });

  it('同じ seed からは同じ判断になる', () => {
    const state = reduce(cpuTable(3), { type: 'startHand', seed: 1 });
    const id = state.turnPlayerId!;
    expect(decide(state, id, 7, FAST)).toEqual(decide(state, id, 7, FAST));
  });

  it('返す行動は必ずルール上正当', () => {
    // 不正な行動を返すと reduce が黙って無視し、進行が止まる。
    const states = collectStates(8, 10);
    for (const [i, state] of states.entries()) {
      const id = state.turnPlayerId!;
      const decision = decide(state, id, i, FAST);
      expect(decision, `局面${i}: 判断が無い`).not.toBeNull();
      expect(
        validate(state, decision!.action),
        `局面${i}: ${decision!.action.type} が不正`,
      ).toBeNull();
    }
  });

  it('レイズ額は必ず下限と上限の内側', () => {
    const states = collectStates(6, 8);
    let raises = 0;
    for (const [i, state] of states.entries()) {
      const id = state.turnPlayerId!;
      const legal = legalActions(state, id)!;
      // seed を振って、レイズを選ぶ場面も拾う
      for (let seed = 0; seed < 3; seed++) {
        const decision = decide(state, id, i * 10 + seed, { ...FAST, aggression: 0.9 })!;
        if (decision.action.type !== 'raise') continue;
        raises++;
        expect(decision.action.to).toBeGreaterThanOrEqual(legal.minRaiseTo);
        expect(decision.action.to).toBeLessThanOrEqual(legal.maxRaiseTo);
      }
    }
    expect(raises, 'レイズが一度も出ていないので検証になっていない').toBeGreaterThan(0);
  });

  it('払う必要がなければ降りない', () => {
    // チェックできる場面でフォールドを選ぶのは、どれだけ弱い手でも損しかない。
    const states = collectStates(8, 10);
    for (const [i, state] of states.entries()) {
      const id = state.turnPlayerId!;
      if (!legalActions(state, id)!.canCheck) continue;
      expect(decide(state, id, i, FAST)!.action.type, `局面${i}`).not.toBe('fold');
    }
  });

  it('判断の根拠を返す', () => {
    const state = reduce(cpuTable(3), { type: 'startHand', seed: 2 });
    const decision = decide(state, state.turnPlayerId!, 1, FAST)!;
    expect(decision.equity).toBeGreaterThanOrEqual(0);
    expect(decision.equity).toBeLessThanOrEqual(1);
    expect(decision.potOdds).toBeGreaterThanOrEqual(0);
    expect(decision.reason.length).toBeGreaterThan(0);
  });
});

describe('CPU だけで対局が回る', () => {
  it('ハンドが必ず決着する', () => {
    for (let seed = 0; seed < 6; seed++) {
      let state = reduce(cpuTable(4), { type: 'startHand', seed });
      let steps = 0;
      while (state.phase !== 'showdown') {
        const decision = decide(state, state.turnPlayerId!, seed * 1000 + steps, FAST)!;
        state = reduce(state, decision.action);
        steps++;
        expect(steps, `seed=${seed}: 決着しない`).toBeLessThan(200);
      }
    }
  });

  it('何ハンド回してもチップの総量が変わらない', () => {
    let state = cpuTable(5, 500);
    const before = totalChips(state);

    for (let hand = 0; hand < 8; hand++) {
      if (validate(state, { type: 'startHand', seed: hand })) break;
      state = reduce(state, { type: 'startHand', seed: hand });

      let steps = 0;
      while (state.phase !== 'showdown') {
        const decision = decide(state, state.turnPlayerId!, hand * 1000 + steps, FAST)!;
        state = reduce(state, decision.action);
        expect(totalChips(state), `hand=${hand} step=${steps}`).toBe(before);
        steps++;
        expect(steps).toBeLessThan(200);
      }
    }
    expect(totalChips(state)).toBe(before);
  });

  it('どのルールのプリセットでも対局できる', () => {
    for (const preset of VARIANT_PRESETS) {
      let state = reduce(cpuTable(3, 1000, preset), { type: 'startHand', seed: 1 });
      let steps = 0;
      while (state.phase !== 'showdown') {
        const decision = decide(state, state.turnPlayerId!, steps, FAST);
        expect(decision, `${preset.name} で判断できない`).not.toBeNull();
        state = reduce(state, decision!.action);
        steps++;
        expect(steps, `${preset.name} で決着しない`).toBeLessThan(200);
      }
    }
  });
});

describe('打ち方の傾向', () => {
  /**
   * 同じ局面に seed を振って、どの行動がどれだけ選ばれるかを測る。
   * 対局を回さずに済むので速い。試行回数をさらに絞っているのは、
   * 傾向を決めているのが勝率の精度ではなく aggression の閾値だから。
   */
  const TENDENCY = { ...FAST, samples: 6 };
  const states = collectStates(6, 8);

  function actionRates(aggression: number) {
    const counts: Record<string, number> = { fold: 0, check: 0, call: 0, raise: 0 };
    let total = 0;
    for (const [i, state] of states.entries()) {
      for (let seed = 0; seed < 5; seed++) {
        const decision = decide(state, state.turnPlayerId!, i * 100 + seed, {
          ...TENDENCY,
          aggression,
        })!;
        counts[decision.action.type] = (counts[decision.action.type] ?? 0) + 1;
        total++;
      }
    }
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total]));
  }

  // 3つのテストで同じ計測を使い回す。毎回測り直すと3倍の時間がかかる。
  const neutral = actionRates(0.5);
  const passive = actionRates(0.05);
  const aggressive = actionRates(0.95);

  it('フォールドばかり・コールばかりにならない', () => {
    expect(neutral['fold'], 'フォールドが多すぎる').toBeLessThan(0.7);
    expect(neutral['fold'], 'まったく降りない').toBeGreaterThan(0.01);
  });

  it('攻撃的な設定のほうがよくレイズする', () => {
    expect(aggressive['raise']).toBeGreaterThan(passive['raise']!);
  });

  it('慎重な設定のほうがよく降りる', () => {
    expect(passive['fold']).toBeGreaterThan(aggressive['fold']!);
  });
});

describe('制度に合わせて打つ', () => {
  const withBetting = (betting: BettingRules): Variant => ({ ...STANDARD_VARIANT, betting });

  function tableFor(variant: Variant, chips = 1000): GameState {
    let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
    for (let i = 0; i < 3; i++) {
      state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips });
    }
    return reduce(state, { type: 'startHand', seed: 5 });
  }

  /** CPU だけで1ハンド回す。決まらなければ進行が止まっている。 */
  function playOut(variant: Variant): GameState {
    let state = tableFor(variant);
    for (let step = 0; step < 200 && state.phase !== 'showdown'; step++) {
      const turn = state.turnPlayerId;
      if (!turn) break;
      const decision = decide(state, turn, step + 1, { ...DEFAULT_STYLE, samples: 20 });
      if (!decision) break;
      const next = reduce(state, decision.action);
      // 弾かれたら同じ state が返る＝CPU が出せない手を選んでいる。
      if (next === state) throw new Error(`CPU の手が弾かれた: ${JSON.stringify(decision.action)}`);
      state = next;
    }
    return state;
  }

  it('フィックスリミットでも最後まで回る', () => {
    // 刻みが決まっているので、ポットサイズのつもりで打つと弾かれる。
    const state = playOut(withBetting({ limit: 'fixed-limit', bigBetFrom: 1, maxRaisesPerRound: 4 }));
    expect(state.phase).toBe('showdown');
  });

  it('ポットリミットでも最後まで回る', () => {
    const state = playOut(withBetting({ limit: 'pot-limit' }));
    expect(state.phase).toBe('showdown');
  });

  it('レイズ回数の上限があっても止まらない', () => {
    const state = playOut(withBetting({ limit: 'no-limit', maxRaisesPerRound: 2 }));
    expect(state.phase).toBe('showdown');
  });

  it('オールイン禁止でも止まらない', () => {
    const state = playOut(
      withBetting({ limit: 'no-limit', streetCaps: [{ street: PREFLOP, noAllIn: true }] }),
    );
    expect(state.phase).toBe('showdown');
  });
});

describe('配る枚数が多いルールでも固まらない', () => {
  it('1手の組み合わせが数千通りでも、試行を削って数秒以内に判断する', () => {
    // 手札6枚・場10枚（役5枚）は 16C5 = 4,368 通り。標準の 21 通りの 200 倍。
    const heavy: Variant = {
      ...STANDARD_VARIANT,
      id: 'heavy',
      name: '重い配り方',
      structure: { holeCards: 6, handSize: 5, streets: [{ name: '場', cards: 10 }] },
    };
    const state = reduce(cpuTable(2, 1000, heavy), { type: 'startHand', seed: 5 });
    const started = performance.now();
    const decision = decide(state, state.turnPlayerId!, 1, DEFAULT_STYLE);
    const elapsed = performance.now() - started;
    expect(decision).not.toBeNull();
    expect(validate(state, decision!.action)).toBeNull();
    expect(elapsed, `判断に ${Math.round(elapsed)}ms かかった`).toBeLessThan(8000);
  });
});
