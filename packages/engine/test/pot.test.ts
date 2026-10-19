import { describe, expect, it } from 'vitest';
import { awardPots, buildPotLayers, returnUncalledBets } from '../src/game/pot.js';
import { evaluateBest } from '../src/rules/evaluate.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import type { Player } from '../src/types.js';
import { cards } from './helpers.js';

/** テスト用のプレイヤー。committed 以外は既定値。 */
function p(
  id: string,
  seat: number,
  committed: number,
  options: { folded?: boolean; chips?: number; inHand?: boolean } = {},
): Player {
  return {
    id,
    name: id,
    seat,
    chips: options.chips ?? 0,
    bet: 0,
    committed,
    holeCards: [],
    exposedHoleCards: [],
    inHand: options.inHand ?? true,
    folded: options.folded ?? false,
    allIn: false,
    hasActed: true,
    waiting: false,
    away: false,
    straddleOn: false,
    leaving: false,
  };
}

const total = (layers: readonly { amount: number }[]) =>
  layers.reduce((sum, l) => sum + l.amount, 0);

describe('コールされなかった分の返却', () => {
  it('自分以外の最大額を超える分は戻る', () => {
    // A が 100、B が 50（オールイン）、C は 10 でフォールド
    const { players, refunds } = returnUncalledBets([
      p('A', 0, 100, { chips: 0 }),
      p('B', 1, 50),
      p('C', 2, 10, { folded: true }),
    ]);

    expect(refunds).toEqual([{ playerId: 'A', amount: 50 }]);
    expect(players.find((x) => x.id === 'A')!.committed).toBe(50);
    expect(players.find((x) => x.id === 'A')!.chips).toBe(50);
    expect(players.find((x) => x.id === 'B')!.committed).toBe(50);
  });

  it('全員が同額なら何も戻らない', () => {
    const { refunds } = returnUncalledBets([p('A', 0, 100), p('B', 1, 100)]);
    expect(refunds).toEqual([]);
  });

  it('全員が降りて誰も受けていないベットは丸ごと戻る', () => {
    // A が 100 出し、他は何も出さずに降りた
    const { refunds } = returnUncalledBets([
      p('A', 0, 100, { chips: 0 }),
      p('B', 1, 0, { folded: true }),
    ]);
    expect(refunds).toEqual([{ playerId: 'A', amount: 100 }]);
  });
});

describe('サイドポットの層分け', () => {
  it('全員同額なら1層', () => {
    const layers = buildPotLayers([p('A', 0, 100), p('B', 1, 100), p('C', 2, 100)]);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual({ amount: 300, eligiblePlayerIds: ['A', 'B', 'C'] });
  });

  it('オールインの額で層が分かれ、短いスタックは上の層を取り合えない', () => {
    // A は 50 でオールイン、B と C は 200
    const layers = buildPotLayers([p('A', 0, 50), p('B', 1, 200), p('C', 2, 200)]);

    expect(layers).toHaveLength(2);
    expect(layers[0]).toEqual({ amount: 150, eligiblePlayerIds: ['A', 'B', 'C'] });
    expect(layers[1]).toEqual({ amount: 300, eligiblePlayerIds: ['B', 'C'] });
    expect(total(layers)).toBe(450);
  });

  it('3段階のオールインで3層になる', () => {
    const layers = buildPotLayers([p('A', 0, 50), p('B', 1, 100), p('C', 2, 300)]);

    expect(layers.map((l) => l.amount)).toEqual([150, 100, 200]);
    expect(layers.map((l) => l.eligiblePlayerIds)).toEqual([
      ['A', 'B', 'C'],
      ['B', 'C'],
      ['C'],
    ]);
    expect(total(layers)).toBe(450);
  });

  it('フォールドした人の出した額はポットに残るが取り合う資格はない', () => {
    const layers = buildPotLayers([
      p('A', 0, 100),
      p('B', 1, 100),
      p('C', 2, 100, { folded: true }),
    ]);

    expect(layers).toHaveLength(1);
    expect(layers[0]!.amount).toBe(300);
    expect(layers[0]!.eligiblePlayerIds).toEqual(['A', 'B']);
  });

  it('層の合計は必ず committed の総和に一致する', () => {
    const players = [p('A', 0, 37), p('B', 1, 115, { folded: true }), p('C', 2, 240), p('D', 3, 115)];
    expect(total(buildPotLayers(players))).toBe(37 + 115 + 240 + 115);
  });
});

describe('ポットの配分', () => {
  const board = 'Qd 7h 3c 2s 9d';
  const hands = new Map(
    (
      [
        // A: Aペア / B: Kペア / C: ハイカード
        ['A', 'As Ah'],
        ['B', 'Ks Kh'],
        ['C', '5s 4h'],
      ] as const
    ).map(([id, hole]) => [id, evaluateBest(cards(`${hole} ${board}`), STANDARD_VARIANT)!]),
  );
  const seatOf = new Map([
    ['A', 0],
    ['B', 1],
    ['C', 2],
  ]);

  it('最強の手が取る', () => {
    const payouts = awardPots(
      [{ amount: 300, eligiblePlayerIds: ['A', 'B', 'C'] }],
      hands,
      seatOf,
      0,
      10,
    );
    expect(payouts).toEqual([{ playerId: 'A', amount: 300 }]);
  });

  it('層ごとに別の勝者が決まる', () => {
    // A が 50 でオールイン。上の層は B と C だけで取り合う。
    const payouts = awardPots(
      [
        { amount: 150, eligiblePlayerIds: ['A', 'B', 'C'] },
        { amount: 300, eligiblePlayerIds: ['B', 'C'] },
      ],
      hands,
      seatOf,
      0,
      10,
    );
    expect(payouts).toContainEqual({ playerId: 'A', amount: 150 });
    expect(payouts).toContainEqual({ playerId: 'B', amount: 300 });
    expect(payouts.find((x) => x.playerId === 'C')).toBeUndefined();
  });

  it('引き分けなら分割する', () => {
    const chop = new Map(
      (
        [
          ['A', 'As Ah'],
          ['B', 'Ad Ac'],
        ] as const
      ).map(([id, hole]) => [id, evaluateBest(cards(`${hole} ${board}`), STANDARD_VARIANT)!]),
    );
    const payouts = awardPots(
      [{ amount: 200, eligiblePlayerIds: ['A', 'B'] }],
      chop,
      seatOf,
      0,
      10,
    );
    expect(payouts).toContainEqual({ playerId: 'A', amount: 100 });
    expect(payouts).toContainEqual({ playerId: 'B', amount: 100 });
  });

  it('割り切れない端数はディーラーの左隣から配られる', () => {
    const chop = new Map(
      (
        [
          ['A', 'As Ah'],
          ['B', 'Ad Ac'],
        ] as const
      ).map(([id, hole]) => [id, evaluateBest(cards(`${hole} ${board}`), STANDARD_VARIANT)!]),
    );

    // A は席0、B は席1。ディーラーが席0なら端数は席1（B）へ。
    const toB = awardPots([{ amount: 201, eligiblePlayerIds: ['A', 'B'] }], chop, seatOf, 0, 10);
    expect(toB).toContainEqual({ playerId: 'B', amount: 101 });
    expect(toB).toContainEqual({ playerId: 'A', amount: 100 });

    // ディーラーが席1なら端数は席2側…を回って席0（A）へ。
    const toA = awardPots([{ amount: 201, eligiblePlayerIds: ['A', 'B'] }], chop, seatOf, 1, 10);
    expect(toA).toContainEqual({ playerId: 'A', amount: 101 });
    expect(toA).toContainEqual({ playerId: 'B', amount: 100 });
  });

  it('配った総額は層の総額と一致する', () => {
    const layers = [
      { amount: 151, eligiblePlayerIds: ['A', 'B', 'C'] },
      { amount: 302, eligiblePlayerIds: ['B', 'C'] },
    ];
    const payouts = awardPots(layers, hands, seatOf, 0, 10);
    expect(payouts.reduce((sum, x) => sum + x.amount, 0)).toBe(453);
  });
});
