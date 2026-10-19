import { type Action, type VisibleState, maxRunsOf } from '@wildcard/engine';

interface RunChoiceBarProps {
  readonly state: VisibleState;
  readonly playerId: string;
  readonly onAction: (action: Action) => void;
}

/**
 * 「何本走るか」を聞く操作。
 *
 * オールインで決着するとき、残りの札を複数回走らせてポットを分ける。
 * 勝ち負けの分散が下がるので、大きなポットほど持ちかけられる。
 *
 * **全員の同意が要る**ので、断る側のボタンも同じ大きさで出す。
 * 押しにくくすると「断りづらい卓」になってしまう。
 */
export function RunChoiceBar({ state, playerId, onAction }: RunChoiceBarProps) {
  if (state.phase !== 'runChoice' || state.turnPlayerId !== playerId) return null;

  const runs = maxRunsOf(state.variant);
  const agreed = state.runChoice?.agreed.length ?? 0;

  return (
    <div className="run-choice">
      <p className="run-choice-note">
        オールインです。残りの札を{runs}本走らせて、ポットを{runs}つに分けますか？
        {agreed > 0 && `（${agreed}人が同意済み）`}
      </p>
      <div className="run-choice-buttons">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onAction({ type: 'runItTwice', playerId, agree: true })}
        >
          {runs}本走る
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => onAction({ type: 'runItTwice', playerId, agree: false })}
        >
          1本でいい
        </button>
      </div>
    </div>
  );
}
