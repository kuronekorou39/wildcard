import { type Action, type VisibleState, maxRunsOf } from '@wildcard/engine';
import { useActionLatch } from '../hooks/useActionLatch.js';

interface RunChoiceBarProps {
  readonly state: VisibleState;
  readonly playerId: string;
  readonly onAction: (action: Action) => void;
  readonly turnId?: number;
  readonly locked?: boolean;
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
export function RunChoiceBar({ state, playerId, onAction, turnId, locked = false }: RunChoiceBarProps) {
  const latch = useActionLatch(JSON.stringify([playerId, turnId, state.runChoice?.agreed]));
  if (state.phase !== 'runChoice' || state.turnPlayerId !== playerId) return null;

  const runs = maxRunsOf(state.variant);
  const agreed = state.runChoice?.agreed.length ?? 0;

  return (
    <div className="run-choice">
      <p className="run-choice-note">
        ラン数{agreed > 0 && ` · ${agreed}人同意`}
      </p>
      <div className="run-choice-buttons">
        <button
          type="button"
          className="btn btn-primary"
          disabled={locked || !latch.enabled}
          onClick={() => latch.run(() => onAction({ type: 'runItTwice', playerId, agree: true }))}
        >
          {runs}本走る
        </button>
        <button
          type="button"
          className="btn"
          disabled={locked || !latch.enabled}
          onClick={() => latch.run(() => onAction({ type: 'runItTwice', playerId, agree: false }))}
        >
          1本でいい
        </button>
      </div>
    </div>
  );
}
