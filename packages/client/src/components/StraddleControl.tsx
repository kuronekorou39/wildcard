import type { Action, VisibleState } from '@wildcard/engine';

interface StraddleControlProps {
  readonly state: VisibleState;
  readonly viewerId: string | null;
  readonly onAction: (action: Action) => void;
}

/**
 * ストラドルを出すかどうかの申告。
 *
 * **配る前に決めるもの**なので、いつ押しても効くのは次のハンドから。
 * 実際の卓でも「次から straddle する」と宣言しておく形になる。
 *
 * 出すと賭け金が倍になり、**出した人がプリフロップで最後に行動する**。
 * 順番が変わることがストラドルの本質なので、そこを説明に書いてある。
 */
export function StraddleControl({ state, viewerId, onAction }: StraddleControlProps) {
  const max = state.variant.betting.straddle?.max ?? 0;
  if (max < 1 || viewerId === null) return null;

  const me = state.players.find((p) => p.id === viewerId);
  if (!me) return null;

  return (
    <label className="checkline straddle-control">
      <input
        type="checkbox"
        checked={me.straddleOn}
        onChange={(e) => onAction({ type: 'setStraddle', playerId: viewerId, on: e.target.checked })}
      />
      <span>
        次のハンドでストラドルを出す
        <small className="checkline-note">
          BB の左隣にいるときだけ有効です。出すと賭け金が倍になり、プリフロップで
          最後に行動します。
        </small>
      </span>
    </label>
  );
}
