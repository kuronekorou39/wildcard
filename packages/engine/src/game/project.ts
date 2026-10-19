import type { Card, GameState, Player } from '../types.js';

export interface VisiblePlayer extends Omit<Player, 'holeCards'> {
  /** 見えるホールカード。伏せられている場合は空配列。 */
  readonly holeCards: readonly Card[];
  /** 伏せられていても枚数は見える（裏向きのカードを何枚持っているか）。 */
  readonly holeCardCount: number;
}

export interface VisibleState extends Omit<GameState, 'players' | 'deck'> {
  readonly players: readonly VisiblePlayer[];
  /** この視点の持ち主。観戦者なら null。 */
  readonly viewerId: string | null;
  /** 山札は枚数だけ見える。中身は誰にも見せない。 */
  readonly deckCount: number;
}

/**
 * 視点ごとに state を伏せる（原則2 —「秘匿はエンジンの責務である」）。
 *
 * 「誰に何が見えるか」を UI や通信層の判断に任せない。
 * この分離があるおかげで、サーバーのない段階0（ソロ・ホットシート）でも
 * project() の結果だけを UI に渡せばホールカードの秘匿が成立する。
 *
 * 見えるのは自分のホールカードと、ショーダウンで公開された手だけ。
 * viewerId が null なら観戦者で、公開された手しか見えない。
 */
export function project(state: GameState, viewerId: string | null): VisibleState {
  const revealedIds = new Set(state.summary?.revealed.map((r) => r.playerId) ?? []);

  const players = state.players.map<VisiblePlayer>((player) => {
    const visible = player.id === viewerId || revealedIds.has(player.id);
    const { holeCards, ...rest } = player;
    return {
      ...rest,
      holeCards: visible ? holeCards : [],
      holeCardCount: holeCards.length,
    };
  });

  const { players: _players, deck, ...rest } = state;
  return { ...rest, players, viewerId, deckCount: deck.length };
}
