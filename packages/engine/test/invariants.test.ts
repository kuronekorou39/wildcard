import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng.js';
import { createGame, legalActions, reduce, validate } from '../src/game/reduce.js';
import type { Action, GameState } from '../src/types.js';

/**
 * ランダムな対局を回して、崩れてはいけない性質を総当たりで確かめる。
 *
 * 進行の不具合は「特定の状況でだけ手番が消える」「オールインが絡むとチップが
 * 増える・減る」といった形で出る。狙って書いたテストでは踏めない組み合わせが
 * 多いので、ランダムに大量のハンドを回して不変条件を見張る。
 */

/** 卓上のチップ総量。どのタイミングでも変わってはいけない。 */
const totalChips = (state: GameState) =>
  state.players.reduce((sum, p) => sum + p.chips, 0) + state.pot;

function checkInvariants(state: GameState, expectedTotal: number, context: string): void {
  expect(totalChips(state), `${context}: チップの総量が変わった`).toBe(expectedTotal);

  const committed = state.players.reduce((sum, p) => sum + p.committed, 0);
  expect(state.pot, `${context}: pot が committed の合計と一致しない`).toBe(committed);

  for (const player of state.players) {
    expect(player.chips, `${context}: ${player.id} のチップが負`).toBeGreaterThanOrEqual(0);
    expect(player.bet, `${context}: ${player.id} の bet が負`).toBeGreaterThanOrEqual(0);
    expect(
      player.committed,
      `${context}: ${player.id} の committed が bet を下回る`,
    ).toBeGreaterThanOrEqual(player.bet);
    if (player.allIn) {
      expect(player.chips, `${context}: ${player.id} はオールインなのにチップが残っている`).toBe(0);
    }
  }

  // ハンドが進行中なら必ず誰かの手番である（手番が消えると永久に止まる）
  if (state.phase !== 'waiting' && state.phase !== 'showdown') {
    expect(state.turnPlayerId, `${context}: 進行中なのに手番がいない`).not.toBeNull();
    expect(legalActions(state, state.turnPlayerId!), `${context}: 手番の人が行動できない`).not.toBeNull();
  }

  // 配られたカードと山札を合わせて重複がない
  const all = [
    ...state.players.filter((p) => p.inHand).flatMap((p) => p.holeCards),
    ...state.communityCards,
    ...state.deck,
  ].map((c) => `${c.rank}${c.suit}`);
  expect(new Set(all).size, `${context}: カードが重複している`).toBe(all.length);
}

/** 手番のプレイヤーが取れる行動をランダムに1つ選ぶ。 */
function randomAction(state: GameState, rng: () => number): Action {
  const playerId = state.turnPlayerId!;
  const legal = legalActions(state, playerId)!;

  const choices: Action[] = [];
  if (legal.canFold) choices.push({ type: 'fold', playerId });
  if (legal.canCheck) choices.push({ type: 'check', playerId });
  if (legal.canCall) choices.push({ type: 'call', playerId });
  if (legal.canRaise) {
    const span = legal.maxRaiseTo - legal.minRaiseTo;
    const to = legal.minRaiseTo + Math.floor(rng() * (span + 1));
    choices.push({ type: 'raise', playerId, to });
  }
  choices.push({ type: 'timeout', playerId });

  return choices[Math.floor(rng() * choices.length)]!;
}

interface PlayoutOptions {
  readonly seats: readonly number[];
  readonly chips: readonly number[];
  readonly hands: number;
  readonly seed: number;
}

/** ランダムに対局を進め、各ステップで不変条件を確かめる。 */
function playout(options: PlayoutOptions): { state: GameState; handsPlayed: number } {
  const rng = createRng(options.seed);
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, dealerSeat: 0 });

  options.seats.forEach((seat, i) => {
    state = reduce(state, {
      type: 'sit',
      playerId: `p${i}`,
      name: `p${i}`,
      seat,
      chips: options.chips[i] ?? 1000,
    });
  });

  const expectedTotal = totalChips(state);
  let handsPlayed = 0;

  for (let hand = 0; hand < options.hands; hand++) {
    const startSeed = options.seed * 1000 + hand;
    if (validate(state, { type: 'startHand', seed: startSeed })) break;

    state = reduce(state, { type: 'startHand', seed: startSeed });
    checkInvariants(state, expectedTotal, `seed=${options.seed} hand=${hand} 開始直後`);
    handsPlayed++;

    let steps = 0;
    while (state.phase !== 'showdown') {
      const action = randomAction(state, rng);
      const before = state;
      state = reduce(state, action);

      expect(
        state,
        `seed=${options.seed} hand=${hand} step=${steps}: 正当な行動が無視された (${action.type})`,
      ).not.toBe(before);
      checkInvariants(state, expectedTotal, `seed=${options.seed} hand=${hand} step=${steps}`);

      steps++;
      expect(steps, `seed=${options.seed} hand=${hand}: ハンドが終わらない`).toBeLessThan(500);
    }
  }

  return { state, handsPlayed };
}

describe('ランダム対局の不変条件', () => {
  it('ヘッズアップを50ハンド回しても崩れない', () => {
    const { handsPlayed } = playout({
      seats: [0, 1],
      chips: [1000, 1000],
      hands: 50,
      seed: 1,
    });
    expect(handsPlayed).toBeGreaterThan(0);
  });

  it('6人卓を50ハンド回しても崩れない', () => {
    const { handsPlayed } = playout({
      seats: [0, 1, 2, 3, 4, 5],
      chips: [1000, 1000, 1000, 1000, 1000, 1000],
      hands: 50,
      seed: 2,
    });
    expect(handsPlayed).toBeGreaterThan(0);
  });

  it('席が飛んでいても崩れない', () => {
    const { handsPlayed } = playout({
      seats: [0, 3, 4, 9],
      chips: [1000, 1000, 1000, 1000],
      hands: 50,
      seed: 3,
    });
    expect(handsPlayed).toBeGreaterThan(0);
  });

  it('スタックがばらばらでも崩れない（サイドポットが頻出する条件）', () => {
    const { handsPlayed } = playout({
      seats: [0, 1, 2, 3, 4],
      chips: [37, 115, 240, 1000, 68],
      hands: 60,
      seed: 4,
    });
    expect(handsPlayed).toBeGreaterThan(0);
  });

  it('多数の seed で回しても崩れない', () => {
    for (let seed = 10; seed < 40; seed++) {
      playout({
        seats: [0, 2, 5, 7],
        chips: [100, 250, 500, 80],
        hands: 20,
        seed,
      });
    }
  });

  it('途中参加・離席・退席を混ぜても崩れない', () => {
    const rng = createRng(777);
    let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, dealerSeat: 0 });
    for (const [i, seat] of [0, 1, 2, 3].entries()) {
      state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat, chips: 500 });
    }
    const expectedTotal = totalChips(state);
    let joined = 0;

    for (let hand = 0; hand < 40; hand++) {
      if (validate(state, { type: 'startHand', seed: hand })) break;
      state = reduce(state, { type: 'startHand', seed: hand });

      let steps = 0;
      while (state.phase !== 'showdown') {
        const roll = rng();

        if (roll < 0.05) {
          // 進行中に新しい人が座る（現ハンドには混ざらないはず）
          const seat = 4 + (joined % 6);
          if (!state.players.some((p) => p.seat === seat)) {
            // 新しいチップが入るので総量の基準も動く。ここでは席だけ試して戻す。
            const probe = reduce(state, {
              type: 'sit',
              playerId: `late${joined}`,
              name: `late${joined}`,
              seat,
              chips: 100,
            });
            expect(probe.players.find((p) => p.id === `late${joined}`)!.inHand).toBe(false);
            joined++;
          }
        } else if (roll < 0.1) {
          // 手番でない人を離席させる
          const other = state.players.find((p) => p.id !== state.turnPlayerId && !p.away);
          if (other) state = reduce(state, { type: 'setAway', playerId: other.id, away: true });
        }

        if (state.phase === 'showdown') break;

        state = reduce(state, randomAction(state, rng));
        checkInvariants(state, expectedTotal, `出入りあり hand=${hand} step=${steps}`);

        steps++;
        expect(steps, `出入りあり hand=${hand}: ハンドが終わらない`).toBeLessThan(500);
      }

      // 次のハンドに備えて全員復帰させる
      state = state.players.reduce(
        (acc, p) => (p.away ? reduce(acc, { type: 'setAway', playerId: p.id, away: false }) : acc),
        state,
      );
    }
  });
});
