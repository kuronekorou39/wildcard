import type { Card, GameState, Player } from '../types.js';

export interface VisiblePlayer extends Omit<Player, 'holeCards'> {
  /**
   * 手札。見えない札は null。
   *
   * 配列の長さは常に実際の枚数なので、UI は「何枚持っているか」と
   * 「そのうちどれが見えるか」を1つの配列から読める。
   * 1枚だけ表になっている状態も素直に表せる。
   */
  readonly holeCards: readonly (Card | null)[];
}

export interface VisibleState extends Omit<GameState, 'players' | 'deck' | 'burned'> {
  readonly players: readonly VisiblePlayer[];
  /** この視点の持ち主。観戦者なら null。 */
  readonly viewerId: string | null;
  /** 山札は枚数だけ見える。中身は誰にも見せない。 */
  readonly deckCount: number;
  /** 焼いたカードも枚数だけ。中身は伏せたまま。 */
  readonly burnedCount: number;
}

/**
 * 視点ごとに state を伏せる（原則2 —「秘匿はエンジンの責務である」）。
 *
 * 「誰に何が見えるか」を UI や通信層の判断に任せない。
 * この分離があるおかげで、サーバーのない段階0（ソロ・ホットシート）でも
 * project() の結果だけを UI に渡せばホールカードの秘匿が成立する。
 *
 * 1枚の札が見えるのは次のいずれか。
 * - 自分の札
 * - 表になっている札（配りミス・本人が見せた・将来のスタッド）
 * - ショーダウンで公開された手
 */
export function project(state: GameState, viewerId: string | null): VisibleState {
  const revealedIds = new Set(state.summary?.revealed.map((r) => r.playerId) ?? []);

  const players = state.players.map<VisiblePlayer>((player) => {
    const wholeHandVisible = player.id === viewerId || revealedIds.has(player.id);
    const exposed = new Set(player.exposedHoleCards);
    const { holeCards, ...rest } = player;

    return {
      ...rest,
      holeCards: holeCards.map((card, i) => (wholeHandVisible || exposed.has(i) ? card : null)),
    };
  });

  const { players: _players, deck, burned, ...rest } = state;
  return { ...rest, players, viewerId, deckCount: deck.length, burnedCount: burned.length };
}
