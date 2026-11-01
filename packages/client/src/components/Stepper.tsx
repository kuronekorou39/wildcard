import { useState, type ReactNode } from 'react';
import { Icon } from './Icon.js';

/**
 * 範囲の決まった小さな整数を −／＋ で動かす。数字を押すと直接入力もできる。
 * 入力は Enter かフォーカスを外すと確定、Esc で取り消し。範囲の外は端に丸める。
 */
export function Stepper({ label, value, min, max, onChange, info, suffix, hideLabel = false, step = 1 }: {
  readonly label: string; readonly value: number; readonly min: number; readonly max: number;
  readonly onChange: (value: number) => void;
  /** ラベルの横に添えるもの（説明の「i」など）。 */
  readonly info?: ReactNode;
  /** 数字のあとに添える単位（「枚」「人」）。 */
  readonly suffix?: string;
  /** ラベルを画面に出さない（読み上げには残る）。行の見出しが別にあるとき。 */
  readonly hideLabel?: boolean;
  /** −／＋ 1回で動く量。直接入力した値もこの刻みに丸める。 */
  readonly step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
    setDraft(null);
  };
  return <div className={`field stepper ${hideLabel ? 'stepper-bare' : ''}`} role="group" aria-label={label}>
    {!hideLabel && <span className="field-label">{label}{info}</span>}
    <div className="stepper-controls">
      <button type="button" aria-label={`${label}を減らす`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Icon kind="minus" /></button>
      {draft === null
        ? <button type="button" className="stepper-value" aria-label={`${label}を入力（いまは ${value}）`} onClick={() => setDraft(String(value))}>{value}{suffix && <small>{suffix}</small>}</button>
        : <input className="stepper-value stepper-input" type="number" inputMode="numeric" aria-label={label} min={min} max={max} value={draft} autoFocus
          onFocus={event => event.currentTarget.select()} onChange={event => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commit(); }
            if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
          }} />}
      <button type="button" aria-label={`${label}を増やす`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Icon kind="plus" /></button>
    </div>
  </div>;
}
