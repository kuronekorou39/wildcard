import { describe, expect, it } from 'vitest';
import { project } from '../src/game/project.js';
import { createGame, reduce } from '../src/game/reduce.js';
import type { Action, GameState } from '../src/types.js';

function tableOf(seats: readonly number[], chips = 1000): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, dealerSeat: 0 });
  seats.forEach((seat, i) => {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat, chips });
  });
  return state;
}

const run = (state: GameState, actions: readonly Action[]) => actions.reduce(reduce, state);

const seen = (state: GameState, viewerId: string | null, targetId: string) =>
  project(state, viewerId).players.find((p) => p.id === targetId)!;

describe('視点ごとの秘匿（原則2）', () => {
  it('自分のホールカードは見える', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    expect(seen(state, 'p0', 'p0').holeCards).toHaveLength(2);
  });

  it('他人のホールカードは見えないが枚数は分かる', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    const other = seen(state, 'p0', 'p1');
    // 見えない札は null。配列の長さは実際の枚数なので、何枚持っているかは分かる。
    expect(other.holeCards).toEqual([null, null]);
  });

  it('山札は中身を一切見せず枚数だけ返す', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    const visible = project(state, 'p0');

    expect(visible.deckCount).toBe(52 - 6);
    expect(visible).not.toHaveProperty('deck');
  });

  it('観戦者には誰のホールカードも見えない', () => {
    const state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    for (const player of project(state, null).players) {
      expect(player.holeCards).toEqual([null, null]);
    }
  });

  it('ショーダウンで公開された手は全員に見える', () => {
    let state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 11 });
    // 両者オールインでボードを配り切る
    state = run(state, [
      { type: 'raise', playerId: 'p0', to: 1000 },
      { type: 'call', playerId: 'p1' },
    ]);
    expect(state.phase).toBe('showdown');

    // 観戦者からも両者の手が見える
    for (const player of project(state, null).players) {
      expect(player.holeCards).toHaveLength(2);
    }
  });

  it('フォールドで決着した場合は勝者の手も公開されない', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'fold', playerId: 'p0' },
      { type: 'fold', playerId: 'p1' },
    ]);
    expect(state.phase).toBe('showdown');
    expect(state.summary?.revealed).toEqual([]);

    // 勝者 p2 の手は他人からは見えないままである
    expect(seen(state, 'p0', 'p2').holeCards).toEqual([null, null]);
    expect(seen(state, 'p2', 'p2').holeCards).toHaveLength(2);
  });

  it('伏せても公開情報はそのまま残る', () => {
    let state = reduce(tableOf([0, 1, 2]), { type: 'startHand', seed: 1 });
    state = run(state, [
      { type: 'call', playerId: 'p0' },
      { type: 'call', playerId: 'p1' },
      { type: 'check', playerId: 'p2' },
    ]);

    const visible = project(state, 'p0');
    expect(visible.phase).toBe('betting');
    expect(visible.streetIndex).toBe(0); // フロップ
    expect(visible.communityCards).toHaveLength(3);
    expect(visible.pot).toBe(state.pot);
    expect(visible.turnPlayerId).toBe(state.turnPlayerId);
    expect(visible.viewerId).toBe('p0');
  });

  it('元の state を書き換えない', () => {
    const state = reduce(tableOf([0, 1]), { type: 'startHand', seed: 1 });
    const before = JSON.stringify(state);
    project(state, 'p0');
    expect(JSON.stringify(state)).toBe(before);
  });
});
