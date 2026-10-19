import { useEffect, useState } from 'react';
import { type Action, type VisibleState, legalActions } from '@wildcard/engine';

interface ActionBarProps {
  readonly state: VisibleState;
  readonly playerId: string;
  readonly onAction: (action: Action) => void;
}

/**
 * 手番のプレイヤーの操作エリア。
 *
 * 何が押せるか、レイズ額の下限と上限は、すべてエンジンの legalActions() が決める。
 * ここで独自に計算すると必ずどこかでエンジンと食い違う。
 */
export function ActionBar({ state, playerId, onAction }: ActionBarProps) {
  const legal = legalActions(state, playerId);
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(0);

  // 手番や状況が変わったらレイズ入力を畳んで、額を下限に戻す。
  useEffect(() => {
    setRaising(false);
    setAmount(legal?.minRaiseTo ?? 0);
  }, [playerId, state.phase, state.currentBet, legal?.minRaiseTo]);

  if (!legal) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  if (raising && legal.canRaise) {
    const isAllIn = amount >= legal.maxRaiseTo;
    const quick = quickAmounts(legal.minRaiseTo, legal.maxRaiseTo, state.pot, player.bet);

    return (
      <div className="action-bar">
        <div className="raise-header">
          <span className="raise-amount">{amount.toLocaleString()}</span>
          {isAllIn && <span className="raise-allin-tag">オールイン</span>}
        </div>

        <input
          className="raise-slider"
          type="range"
          min={legal.minRaiseTo}
          max={legal.maxRaiseTo}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="レイズ額"
        />

        <div className="raise-quick">
          {quick.map(({ label, value }) => (
            <button key={label} type="button" className="btn btn-quick" onClick={() => setAmount(value)}>
              {label}
            </button>
          ))}
        </div>

        <div className="action-row">
          <button type="button" className="btn btn-muted" onClick={() => setRaising(false)}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-raise"
            onClick={() => onAction({ type: 'raise', playerId, to: amount })}
          >
            {isAllIn ? 'オールイン' : `${amount.toLocaleString()} にレイズ`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="action-row">
        <button
          type="button"
          className="btn btn-fold"
          onClick={() => onAction({ type: 'fold', playerId })}
        >
          フォールド
        </button>

        {legal.canCheck ? (
          <button
            type="button"
            className="btn btn-call"
            onClick={() => onAction({ type: 'check', playerId })}
          >
            チェック
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-call"
            onClick={() => onAction({ type: 'call', playerId })}
          >
            コール {legal.callAmount.toLocaleString()}
            {legal.callAmount === player.chips && <span className="btn-note">オールイン</span>}
          </button>
        )}

        {legal.canRaise && (
          <button type="button" className="btn btn-raise" onClick={() => setRaising(true)}>
            レイズ
          </button>
        )}
      </div>
    </div>
  );
}

interface QuickAmount {
  readonly label: string;
  readonly value: number;
}

/** よく使う額のショートカット。下限と上限の外には出さない。 */
function quickAmounts(min: number, max: number, pot: number, ownBet: number): QuickAmount[] {
  const candidates: QuickAmount[] = [
    { label: '最小', value: min },
    { label: '1/2 ポット', value: ownBet + Math.round(pot / 2) },
    { label: 'ポット', value: ownBet + pot },
    { label: 'オールイン', value: max },
  ];

  const seen = new Set<number>();
  return candidates
    .map((c) => ({ ...c, value: Math.min(Math.max(c.value, min), max) }))
    .filter((c) => {
      if (seen.has(c.value)) return false;
      seen.add(c.value);
      return true;
    });
}
