import { type Action, type VisibleState, showCardsPolicyOf } from '@wildcard/engine';

interface ShowCardsControlProps {
  readonly state: VisibleState;
  readonly viewerId: string | null;
  readonly onAction: (action: Action) => void;
}

/**
 * 自分の手札を見せる操作。
 *
 * 「勝負は流れたけど、ブラフだったことだけ見せたい」ための口。
 * 何枚まで見せられるかは卓の作法（showCards）が決める。
 * 勝負の途中には出さない——エンジン側でも弾いているが、押せること自体が
 * 誤解を生むので、ボタンそのものを出さない。
 */
export function ShowCardsControl({ state, viewerId, onAction }: ShowCardsControlProps) {
  const policy = showCardsPolicyOf(state.variant);
  if (policy === 'none' || viewerId === null) return null;

  const me = state.players.find((p) => p.id === viewerId);
  if (!me || me.holeCards.length === 0) return null;

  // 降りた後か、決着した後だけ。
  if (state.phase === 'betting' && !me.folded) return null;

  const alreadyShown = me.exposedHoleCards.length;
  if (policy === 'one' && alreadyShown >= 1) return null;

  const hidden = me.holeCards
    .map((card, index) => ({ card, index }))
    .filter(({ index }) => !me.exposedHoleCards.includes(index));
  if (hidden.length === 0) return null;

  return (
    <div className="show-cards">
      <span className="show-cards-label">手札を見せる</span>
      {hidden.map(({ card, index }) => (
        <button
          key={index}
          type="button"
          className="btn btn-muted btn-small"
          onClick={() => onAction({ type: 'showCard', playerId: viewerId, index })}
        >
          {card ? `${card.rank} を見せる` : `${index + 1}枚目を見せる`}
        </button>
      ))}
    </div>
  );
}
