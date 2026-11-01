import { Icon } from './Icon.js';

/** 枚数のような小さな整数を −／＋ で動かす。数字を打たせない。 */
export function Stepper({ label, value, min, max, onChange, compact = false }: {
  readonly label: string; readonly value: number; readonly min: number; readonly max: number;
  readonly onChange: (value: number) => void; readonly compact?: boolean;
}) {
  return <div className={`field stepper ${compact ? 'stepper-compact' : ''}`} role="group" aria-label={label}>
    {!compact && <span className="field-label">{label}</span>}
    <div className="stepper-controls">
      <button type="button" aria-label={`${label}を減らす`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon kind="minus" /></button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" aria-label={`${label}を増やす`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon kind="plus" /></button>
    </div>
  </div>;
}
