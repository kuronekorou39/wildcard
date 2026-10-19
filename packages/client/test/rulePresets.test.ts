import { describe, expect, it } from 'vitest';
import { VARIANT_PRESETS, buildDeck, findVariant } from '@wildcard/engine';
import { LocalTransport } from '../src/transport/local.js';

/** 選んだプリセットが本当にエンジンまで届いているかを見る。 */
function tableWith(variantId: string) {
  const variant = findVariant(variantId);
  return new LocalTransport({
    seatCount: 3,
    smallBlind: 10,
    bigBlind: 20,
    ...(variant ? { variant } : {}),
    viewer: { kind: 'followTurn' },
    setup: [
      { type: 'sit', playerId: 'p0', name: 'p0', seat: 0, chips: 1000 },
      { type: 'sit', playerId: 'p1', name: 'p1', seat: 1, chips: 1000 },
    ],
  });
}

describe('ルールのプリセットが卓に反映される', () => {
  it('既定は標準ルール', () => {
    expect(tableWith('standard').snapshot().state.variant.id).toBe('standard');
  });

  it('ショートデッキを選ぶと36枚で配られる', () => {
    const transport = tableWith('short-deck');
    transport.dispatch({ type: 'startHand', seed: 1 });
    const { state } = transport.snapshot();

    expect(state.variant.id).toBe('short-deck');
    // 36枚から4枚配られている
    expect(state.deckCount).toBe(36 - 4);
    // 2〜5 は入っていない
    const dealt = transport.rawState().players.flatMap((p) => p.holeCards);
    expect(dealt.every((c) => !['2', '3', '4', '5'].includes(c.rank))).toBe(true);
  });

  it('独自役入りを選ぶと役の一覧が増える', () => {
    const state = tableWith('house-hands').snapshot().state;
    const ids = state.variant.ranking.hands.map((r) => r.id);
    expect(ids).toContain('mini_straight');
    expect(ids).toContain('pair_plus_run');
  });

  it('知らない id なら標準に落ちる', () => {
    expect(tableWith('存在しないルール').snapshot().state.variant.id).toBe('standard');
  });

  it('どのプリセットでもハンドを開始できる', () => {
    for (const preset of VARIANT_PRESETS) {
      const transport = tableWith(preset.id);
      transport.dispatch({ type: 'startHand', seed: 3 });
      const { state } = transport.snapshot();
      expect(state.phase, `${preset.name} で開始できない`).toBe('betting');
      // 配られる枚数はバリアント次第。オマハなら2人で8枚。
      expect(state.deckCount).toBe(buildDeck(preset.deck).length - preset.structure.holeCards * 2);
    }
  });
});
