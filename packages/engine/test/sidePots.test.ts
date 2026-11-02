import { describe, expect, it } from 'vitest';
import { potsInPlay } from '../src/game/pot.js';
import { createGame, legalActions, reduce, validate } from '../src/game/reduce.js';
import { createRng } from '../src/rng.js';
import type { Action, GameState, Player } from '../src/types.js';

/**
 * ポットの内訳（メインポット、サイドポット1, 2, …）。
 * ハンド中の表示（potsInPlay）と、決着の内訳（summary.pots）を確かめる。
 */

type Seat = Pick<Player, 'id' | 'committed' | 'bet' | 'allIn' | 'inHand' | 'folded'>;
const seat = (id: string, committed: number, options: Partial<Seat> = {}): Seat => ({
  id, committed, bet: 0, allIn: false, inHand: true, folded: false, ...options,
});

describe('ハンド中のポットの内訳', () => {
  it('オールインが無ければ1つだけ', () => {
    expect(potsInPlay([seat('A', 100), seat('B', 100), seat('C', 40, { folded: true })]))
      .toEqual([{ amount: 240, eligiblePlayerIds: ['A', 'B'] }]);
  });

  it('オールインした人の額でメインとサイドに分かれる', () => {
    const pots = potsInPlay([
      seat('A', 50, { allIn: true }),
      seat('B', 200, { allIn: true }),
      seat('C', 300),
      seat('D', 300),
    ]);
    expect(pots).toEqual([
      { amount: 200, eligiblePlayerIds: ['A', 'B', 'C', 'D'] },
      { amount: 450, eligiblePlayerIds: ['B', 'C', 'D'] },
      { amount: 200, eligiblePlayerIds: ['C', 'D'] },
    ]);
  });

  it('前に置いたままの賭けはまだ数えない', () => {
    // C が今のラウンドで 100 賭けたところ。中央にはまだ入っていない。
    const pots = potsInPlay([seat('A', 50, { allIn: true }), seat('B', 150, { bet: 100 }), seat('C', 150, { bet: 100 })]);
    expect(pots.reduce((sum, p) => sum + p.amount, 0)).toBe(150);
    expect(pots).toEqual([{ amount: 150, eligiblePlayerIds: ['A', 'B', 'C'] }]);
  });

  it('降りた人の額では分かれない', () => {
    expect(potsInPlay([seat('A', 100), seat('B', 100), seat('C', 30, { folded: true }), seat('D', 60, { folded: true })]))
      .toHaveLength(1);
  });

  it('1人しか取り合えない分（誰にも受けられていない額）はポットとして出さない', () => {
    const pots = potsInPlay([seat('A', 50, { allIn: true }), seat('B', 300)]);
    expect(pots).toEqual([{ amount: 100, eligiblePlayerIds: ['A', 'B'] }]);
  });
});

function randomAction(state: GameState, rng: () => number): Action {
  const playerId = state.turnPlayerId!;
  const legal = legalActions(state, playerId)!;
  if (legal.canRaise && rng() < 0.3) return { type: 'raise', playerId, to: rng() < 0.5 ? legal.maxRaiseTo : legal.minRaiseTo };
  if (legal.canCall && rng() < 0.8) return { type: 'call', playerId };
  if (legal.canCheck) return { type: 'check', playerId };
  return { type: 'fold', playerId };
}

describe('決着のポットの内訳', () => {
  it('ポットごとの取り分を足すと、配当と一致する。ハンド中に見えていた内訳とも額が合う', () => {
    const rng = createRng(31);
    let sidePotHands = 0;
    for (let game = 0; game < 40; game++) {
      let state = createGame({ seatCount: 6, smallBlind: 5, bigBlind: 10 });
      for (let i = 0; i < 6; i++) {
        state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips: 20 + Math.floor(rng() * 300) });
      }
      for (let hand = 0; hand < 10; hand++) {
        const seed = game * 100 + hand;
        if (validate(state, { type: 'startHand', seed })) break;
        state = reduce(state, { type: 'startHand', seed });
        let lastShown = potsInPlay(state.players);
        while (state.phase !== 'showdown') {
          state = reduce(state, randomAction(state, rng));
          if (state.phase !== 'showdown') lastShown = potsInPlay(state.players);
        }
        const summary = state.summary!;
        const pots = summary.pots!;
        const byPlayer = new Map<string, number>();
        for (const pot of pots) {
          expect(pot.winners.reduce((sum, w) => sum + w.amount, 0), `seed=${seed}`).toBe(pot.amount);
          for (const w of pot.winners) {
            expect(pot.eligiblePlayerIds, `seed=${seed}`).toContain(w.playerId);
            byPlayer.set(w.playerId, (byPlayer.get(w.playerId) ?? 0) + w.amount);
          }
        }
        const awards = new Map((summary.awards ?? []).filter((a) => a.amount > 0).map((a) => [a.playerId, a.amount]));
        expect(Object.fromEntries(byPlayer), `seed=${seed}`).toEqual(Object.fromEntries(awards));
        if (pots.length > 1) sidePotHands++;
        // 決着直前に見えていた内訳は、決着のポットの先頭から同じ額で並ぶ（最後のポットは未回収の賭けのぶん増えうる）。
        if (summary.revealed.length > 0) {
          expect(lastShown.length, `seed=${seed}`).toBeLessThanOrEqual(pots.length);
          lastShown.slice(0, -1).forEach((shown, i) => expect(shown.amount, `seed=${seed} pot=${i}`).toBe(pots[i]!.amount));
        }
      }
    }
    expect(sidePotHands).toBeGreaterThan(5);
  });
});
