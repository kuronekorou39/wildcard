import { useEffect, useState } from 'react';
import { type Action, type VisibleState, legalActions } from '@wildcard/engine';
import { useActionLatch } from '../hooks/useActionLatch.js';

interface ActionBarProps {
  readonly state: VisibleState;
  readonly playerId: string;
  readonly onAction: (action: Action) => void;
  readonly turnId?: number;
}

/**
 * 手番のプレイヤーの操作エリア。
 *
 * 何が押せるか、レイズ額の下限と上限は、すべてエンジンの legalActions() が決める。
 * ここで独自に計算すると必ずどこかでエンジンと食い違う。
 */
export function ActionBar({ state, playerId, onAction, turnId }: ActionBarProps) {
  const legal = legalActions(state, playerId);
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(0);
  const latch = useActionLatch(JSON.stringify([turnId, playerId, state.phase, state.streetIndex, state.currentBet, raising]));
  const send = (action: Action) => latch.run(() => onAction(action));

  // 手番や状況が変わったらレイズ入力を畳んで、額を下限に戻す。
  useEffect(() => {
    setRaising(false);
    setAmount(legal?.minRaiseTo ?? 0);
  }, [turnId, playerId, state.phase, state.streetIndex, state.currentBet, legal?.minRaiseTo]);

  if (!legal) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  // 額が1つしかない制度（フィックスリミット）では、選ばせる意味がない。
  const fixedAmount = legal.canRaise && legal.minRaiseTo === legal.maxRaiseTo;

  if (raising && legal.canRaise && !fixedAmount) {
    // ポットリミットでは上限がポットで決まる。手持ちが残っていれば
    // 上限いっぱいでもオールインではない。
    const isAllIn = amount >= player.bet + player.chips;
    const quick = quickAmounts({
      min: legal.minRaiseTo,
      max: legal.maxRaiseTo,
      pot: state.pot,
      ownBet: player.bet,
      currentBet: state.currentBet,
      allIn: player.bet + player.chips,
    });

    return (
      <div className="action-bar action-bar-raising">
        <div className="raise-controls" role="group" aria-label="レイズ額の調整">
          <div className="raise-header">
            <span className="raise-label">レイズ先</span>
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
        </div>

        <div className="action-row action-row-confirm">
          <button
            type="button"
            className="btn btn-raise"
            disabled={!latch.enabled}
            onClick={() => send({ type: 'raise', playerId, to: amount })}
          >
            {isAllIn ? 'オールイン' : `${amount.toLocaleString()} にレイズ`}
          </button>
          <button type="button" className="btn btn-muted" onClick={() => setRaising(false)}>
            やめる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-bar">
      <div className="action-guidance">
        <span>あなたのアクション</span>
        <strong>{legal.canCheck ? 'チェックできます' : `コール ${legal.callAmount.toLocaleString()}`}</strong>
        {legal.canRaise && !fixedAmount && <small>レイズを選ぶと、ここで金額を調整できます</small>}
      </div>
      <div className="action-row">
        <button
          type="button"
          className="btn btn-fold"
          disabled={!latch.enabled}
          onClick={() => send({ type: 'fold', playerId })}
        >
          フォールド
        </button>

        {legal.canCheck ? (
          <button
            type="button"
            className="btn btn-call"
            disabled={!latch.enabled}
            onClick={() => send({ type: 'check', playerId })}
          >
            チェック
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-call"
            disabled={!latch.enabled}
            onClick={() => send({ type: 'call', playerId })}
          >
            コール {legal.callAmount.toLocaleString()}
            {legal.callAmount === player.chips && <span className="btn-note">オールイン</span>}
          </button>
        )}

        {legal.canRaise && (
          <button
            type="button"
            className="btn btn-raise"
            disabled={!latch.enabled}
            onClick={() =>
              fixedAmount
                ? send({ type: 'raise', playerId, to: legal.minRaiseTo })
                : setRaising(true)
            }
          >
            {fixedAmount ? `レイズ ${legal.minRaiseTo.toLocaleString()}` : 'レイズ'}
          </button>
        )}
      </div>
    </div>
  );
}

export interface QuickAmount {
  readonly label: string;
  readonly value: number;
}

export interface QuickAmountInput {
  readonly min: number;
  readonly max: number;
  readonly pot: number;
  readonly ownBet: number;
  readonly currentBet: number;
  /**
   * 手持ちを全部出したときの額。
   *
   * 上限と一致するとは限らない。ポットリミットでは上限がポットで決まるし、
   * 「オールイン禁止」の卓では1枚残す上限になる。**上限を「オールイン」と
   * 書いてしまうと嘘になる**ので、本当の全額をここで受け取る。
   */
  readonly allIn: number;
}

/**
 * よく使うレイズ額のショートカット。
 *
 * ポットサイズレイズは「コールしてからポットぶんを上乗せする」額である。
 * コールした時点でポットは pot + toCall になるので、
 *   レイズ先 = currentBet + (pot + toCall)
 * となる。コール額を無視して pot だけ足すと、相手のベットが大きいほど
 * 実際のポットサイズから外れていく。
 *
 * 値は必ず legalActions が出した下限・上限に収める。重複した候補は畳む。
 */
export function quickAmounts({
  min,
  max,
  pot,
  ownBet,
  currentBet,
  allIn,
}: QuickAmountInput): QuickAmount[] {
  const toCall = Math.max(0, currentBet - ownBet);
  const potAfterCall = pot + toCall;

  const candidates: QuickAmount[] = [
    { label: '最小', value: min },
    { label: '1/2 ポット', value: currentBet + Math.round(potAfterCall / 2) },
    { label: 'ポット', value: currentBet + potAfterCall },
    // 上限が手持ち全部とは限らない。違うなら「オールイン」とは書かない。
    { label: max >= allIn ? 'オールイン' : '上限', value: max },
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
