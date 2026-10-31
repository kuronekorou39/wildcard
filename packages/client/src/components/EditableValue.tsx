import { useId, useRef, useState } from 'react';

interface Props {
  readonly label: string;
  readonly value: string | number;
  readonly onChange: (value: string) => void;
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly suffix?: string;
  readonly placeholder?: string;
  readonly compact?: boolean;
  /** 複数行の文章。Enter は改行、Ctrl+Enter（⌘+Enter）で確定。 */
  readonly multiline?: boolean;
}

/** Values stay readable until explicitly edited; Escape always discards the draft. */
function EditableValue({ label, value, onChange, min, max, maxLength, suffix, placeholder, compact = false, multiline = false }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  const restoreFocus = useRef(false);
  const valueId = useId();
  const number = typeof value === 'number';
  const commit = () => {
    if (cancelled.current) return;
    if (number && (draft.trim() === '' || !Number.isSafeInteger(Number(draft)) || Number(draft) < (min ?? 0) || Number(draft) > (max ?? Number.MAX_SAFE_INTEGER))) {
      setError(`${min ?? 0}${max === undefined ? '以上' : `〜${max}`}の整数を入力してください`);
      setEditing(false);
      return;
    }
    setError('');
    onChange(draft);
    setEditing(false);
  };
  const focusOnMount = (element: HTMLInputElement | HTMLTextAreaElement | null) => { if (element && document.activeElement !== element) { element.focus(); element.select(); } };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; restoreFocus.current = true; setEditing(false); }
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); restoreFocus.current = true; commit(); }
  };
  return <div className={`field editable-field ${compact ? 'editable-compact' : ''} ${multiline ? 'editable-multiline' : ''}`}>
    <span className="field-label">{label}</span>
    {editing && multiline ? <>
      <textarea className="input editable-input editable-textarea" aria-label={label} maxLength={maxLength} placeholder={placeholder}
        rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))} value={draft} ref={focusOnMount}
        onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
      <small className="hint editable-hint">Ctrl+Enter で確定、Esc で取り消し</small>
    </> : editing ? <input className="input editable-input" aria-label={label}
      type={number ? 'number' : 'text'} inputMode={number ? 'numeric' : undefined}
      min={min} max={max} step={number ? 1 : undefined} maxLength={maxLength} placeholder={placeholder}
      value={draft} ref={focusOnMount}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={onKeyDown} /> : <button type="button" className={`editable-value ${!number && !value ? 'editable-empty' : ''}`} aria-label={`${label}を編集`} aria-describedby={valueId}
      ref={element => { if (element && restoreFocus.current) { restoreFocus.current = false; element.focus(); } }}
      onClick={() => { cancelled.current = false; setDraft(String(value)); setError(''); setEditing(true); }}>
      <span id={valueId}>{number ? value.toLocaleString() : value || placeholder || '未設定'}{suffix && <small>{suffix}</small>}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5 4 4M5 15 15 5a2.8 2.8 0 0 1 4 4L9 19l-5 1z" /></svg>
    </button>}
    {error && <small className="hint hint-warn" role="alert">{error}</small>}
  </div>;
}

export function EditableNumber(props: Omit<Props, 'value' | 'onChange'> & { readonly value: number; readonly onChange: (value: number) => void }) {
  return <EditableValue {...props} onChange={value => props.onChange(Number(value))} />;
}
export function EditableText(props: Omit<Props, 'value'> & { readonly value: string }) {
  return <EditableValue {...props} />;
}

export function TableStakes({ chips, smallBlind, bigBlind, ante = 0, onChips, onSmallBlind, onBigBlind, onAnte }: {
  readonly chips: number; readonly smallBlind: number; readonly bigBlind: number;
  readonly onChips: (value: number) => void; readonly onSmallBlind: (value: number) => void; readonly onBigBlind: (value: number) => void;
  readonly ante?: number; readonly onAnte?: (value: number) => void;
}) {
  return <div className="field-row table-stakes">
    <EditableNumber label="初期チップ" value={chips} min={1} onChange={onChips} />
    <EditableNumber label="SB" value={smallBlind} min={1} onChange={onSmallBlind} />
    <EditableNumber label="BB" value={bigBlind} min={1} onChange={onBigBlind} />
    {onAnte && <EditableNumber label="アンティ / 人" value={ante} min={0} max={1_000_000_000} onChange={onAnte} />}
  </div>;
}
