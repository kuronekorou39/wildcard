import { describe, expect, it } from 'vitest';
import { createGame, createRng, entropySource, project, reduce, STANDARD_VARIANT } from '../src/index.js';

describe('サーバーから渡す配牌用の乱数', () => {
  it('同じ入力を再現でき、入力配列を変更せず、公開状態に乱数を残さない', () => {
    const rng = createRng(77);
    const entropy = Array.from({ length: 2000 }, () => Math.floor(rng() * 0x100000000));
    const before = entropy.slice();
    let game = createGame({ variant: STANDARD_VARIANT });
    for (let i = 0; i < 3; i++) game = reduce(game, { type: 'sit', playerId: `p${i}`, name: `P${i}`, seat: i, chips: 1000 });
    const action = { type: 'startHand' as const, seed: 0, entropy };
    const dealt = reduce(game, action);
    expect(dealt).toEqual(reduce(game, action));
    expect(dealt.players.map(player => player.holeCards)).not.toEqual(reduce(game, { type: 'startHand', seed: 0 }).players.map(player => player.holeCards));
    expect(entropy).toEqual(before);
    expect(JSON.stringify(project(dealt, 'p0'))).not.toContain('entropy');
  });
  it('範囲に割り切れない uint32 を捨て、乱数不足は黙って補わない', () => {
    expect(entropySource([0xffffffff, 7]).index(10)).toBe(7);
    expect(() => entropySource([]).next()).toThrow();
  });
});
