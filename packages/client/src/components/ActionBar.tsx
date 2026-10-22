import { useEffect, useState } from 'react';
import { type Action, type VisibleState, legalActions } from '@wildcard/engine';
import { useActionLatch } from '../hooks/useActionLatch.js';
import { ActionIcon } from './ActionIcon.js';
import { raiseScale } from '../raiseScale.js';

interface ActionBarProps {
  readonly state: VisibleState;
  readonly playerId: string;
  readonly onAction: (action: Action) => void;
  readonly turnId?: number;
  readonly locked?: boolean;
}

/**
 * 手番のプレイヤーの操作エリア。
 *
 * 何が押せるか、レイズ額の下限と上限は、すべてエンジンの legalActions() が決める。
 * ここで独自に計算すると必ずどこかでエンジンと食い違う。
 */
export function ActionBar({ state, playerId, onAction, turnId, locked = false }: ActionBarProps) {
  const legal = legalActions(state, playerId);
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const latch = useActionLatch(JSON.stringify([turnId, playerId, state.phase, state.streetIndex, state.currentBet, raising]));
  const send = (action: Action) => { if (!locked) latch.run(() => onAction(action)); };

  // 手番や状況が変わったらレイズ入力を畳んで、額を下限に戻す。
  useEffect(() => {
    setRaising(false);
    setAmount(legal?.minRaiseTo ?? 0);
    setDraft(null);
  }, [turnId, playerId, state.phase, state.streetIndex, state.currentBet, legal?.minRaiseTo]);

  if (!legal) return null;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  // 額が1つしかない制度（フィックスリミット）では、選ばせる意味がない。
  const fixedAmount = legal.canRaise && legal.minRaiseTo === legal.maxRaiseTo;

  if (raising && legal.canRaise && !fixedAmount) {
    const scale = raiseScale(legal.minRaiseTo, legal.maxRaiseTo, state.bigBlind);
    const valid = draft === null || (/^\d+$/.test(draft) && Number.isSafeInteger(Number(draft)) && Number(draft) >= legal.minRaiseTo && Number(draft) <= legal.maxRaiseTo);
    const choose = (value: number) => { setAmount(Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(value)))); setDraft(null); };
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
            <span className="raise-label">レイズ先</span><span className="raise-limits" data-invalid={!valid}>
              {legal.minRaiseTo.toLocaleString()}–{legal.maxRaiseTo.toLocaleString()}
            </span>
            <div className="raise-amount-editor">
              <button type="button" className="btn raise-step" aria-label="1チップ減らす" disabled={valid && amount <= legal.minRaiseTo} onClick={() => choose(amount - 1)}>−</button>
              <input className="raise-amount" type="text" inputMode="numeric" pattern="[0-9]*" aria-label="レイズ先の金額"
                aria-invalid={!valid} value={draft ?? String(amount)} onFocus={e => e.currentTarget.select()}
                onChange={e => {
                  const value = e.target.value; setDraft(value);
                  if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= legal.minRaiseTo && Number(value) <= legal.maxRaiseTo) setAmount(Number(value));
                }}
                onKeyDown={e => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); choose(amount + (e.key === 'ArrowUp' ? 1 : -1)); }
                  if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                }} />
              <button type="button" className="btn raise-step" aria-label="1チップ増やす" disabled={valid && amount >= legal.maxRaiseTo} onClick={() => choose(amount + 1)}>+</button>
            </div>
            {isAllIn && <span className="raise-allin-tag">オールイン</span>}
          </div>

          <div className="raise-track">
          <span className="raise-midpoint" aria-hidden="true">{scale.middle.toLocaleString()}</span>
          <input
            className="raise-slider"
            type="range"
            min={0}
            max={1000}
            step={1}
            value={scale.positionOf(amount)}
            onChange={(e) => choose(scale.amountAt(Number(e.target.value)))}
            onKeyDown={e => {
              const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: state.bigBlind, PageDown: -state.bigBlind }[e.key];
              if (delta !== undefined) { e.preventDefault(); choose(amount + delta); }
              else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); choose(e.key === 'Home' ? legal.minRaiseTo : legal.maxRaiseTo); }
            }}
            aria-label="レイズ額"
            aria-valuemin={legal.minRaiseTo}
            aria-valuemax={legal.maxRaiseTo}
            aria-valuenow={amount}
            aria-valuetext={`${amount.toLocaleString()} チップ`}
            aria-orientation="vertical"
          />
          </div>

          <div className="raise-quick">
            {quick.slice().reverse().map(({ label, value }) => (
              <button key={label} type="button" className="btn btn-quick" aria-label={label} title={`${value.toLocaleString()} チップ`}
                aria-pressed={valid && amount === value} onClick={() => choose(value)}>
                <span>{label}</span><strong>{value.toLocaleString()}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="action-row action-row-confirm">
          <button
            type="button"
            className="btn btn-raise"
            aria-label={isAllIn ? 'オールイン' : `${amount.toLocaleString()} にレイズ`}
            disabled={locked || !latch.enabled || !valid}
            onClick={() => send({ type: 'raise', playerId, to: amount })}
          >
            <ActionIcon kind="raise" /><span>{isAllIn ? 'オールイン' : 'レイズ確定'}</span><strong>{amount.toLocaleString()}</strong>
          </button>
          <button type="button" className="btn btn-muted" onClick={() => setRaising(false)}>
            <ActionIcon kind="cancel" /><span>やめる</span>
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
          disabled={locked || !latch.enabled}
          onClick={() => send({ type: 'fold', playerId })}
        >
          <ActionIcon kind="fold" /><span>フォールド</span>
        </button>

        {legal.canCheck ? (
          <button
            type="button"
            className="btn btn-call"
            disabled={locked || !latch.enabled}
            onClick={() => send({ type: 'check', playerId })}
          >
            <ActionIcon kind="check" /><span>チェック</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-call"
            aria-label={`コール ${legal.callAmount.toLocaleString()}${legal.callAmount === player.chips ? ' オールイン' : ''}`}
            disabled={locked || !latch.enabled}
            onClick={() => send({ type: 'call', playerId })}
          >
            <span>コール</span><strong>{legal.callAmount.toLocaleString()}</strong>
            {legal.callAmount === player.chips && <span className="btn-note">オールイン</span>}
          </button>
        )}

        {legal.canRaise && (
          <button
            type="button"
            className="btn btn-raise"
            disabled={locked || !latch.enabled}
            onClick={() =>
              fixedAmount
                ? send({ type: 'raise', playerId, to: legal.minRaiseTo })
                : setRaising(true)
            }
          >
            <ActionIcon kind="raise" /><span>{fixedAmount ? `レイズ ${legal.minRaiseTo.toLocaleString()}` : 'レイズ'}</span>
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
