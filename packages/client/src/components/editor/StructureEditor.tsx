import { EditableText } from '../EditableValue.js';
import { Stepper } from '../Stepper.js';
import { Icon } from '../Icon.js';
import { boardSize, type HandStructure, type Street, type UsageRange } from '@wildcard/engine';

interface StructureEditorProps {
  readonly structure: HandStructure;
  readonly onChange: (structure: HandStructure) => void;
}

/**
 * 配り方の編集。
 *
 * ストリートの「焼く枚数」は結果の確率分布を変えないが、**必要なデッキ枚数は変える**。
 * 指定できないと「52枚きっかりで回るはず」が狂うので、画面にも出す。
 */
export function StructureEditor({ structure, onChange }: StructureEditorProps) {
  const set = (patch: Partial<HandStructure>) => onChange({ ...structure, ...patch });

  const setStreet = (at: number, patch: Partial<Street>) =>
    set({
      streets: structure.streets.map((street, i) => (i === at ? { ...street, ...patch } : street)),
    });

  const addStreet = () =>
    set({
      streets: [
        ...structure.streets,
        { name: `ストリート${structure.streets.length + 1}`, cards: 1, burn: 1 },
      ],
    });

  const removeStreet = (at: number) =>
    set({ streets: structure.streets.filter((_, i) => i !== at) });

  return (
    <section className="panel" aria-label="配り方">

      <div className="field-row stepper-row">
        <Stepper label="手札" suffix="枚" value={structure.holeCards} min={0} max={20} onChange={holeCards => set({ holeCards })} />
        <Stepper label="役を作る枚数" suffix="枚" value={structure.handSize} min={1} max={10} onChange={handSize => set({ handSize })} />
      </div>

      <UsageField
        label="手札から使う枚数"
        usage={structure.holeUsage}
        limit={structure.holeCards}
        onChange={(holeUsage) =>
          onChange(
            holeUsage === undefined
              ? omit(structure, 'holeUsage')
              : { ...structure, holeUsage },
          )
        }
      />

      <UsageField
        label="場から使う枚数"
        usage={structure.boardUsage}
        limit={boardSize(structure)}
        onChange={(boardUsage) =>
          onChange(
            boardUsage === undefined
              ? omit(structure, 'boardUsage')
              : { ...structure, boardUsage },
          )
        }
      />

      <details className="field street-details">
        <summary className="street-summary">
          <span className="field-label">場に開く段階</span>
          <small>{structure.streets.length === 0 ? 'なし' : `${structure.streets.map((street) => street.cards).join('・')}枚（場 ${boardSize(structure)}枚 / 焼く ${structure.streets.reduce((n, street) => n + (street.burn ?? 0), 0)}枚）`}</small>
        </summary>
        {structure.streets.length === 0 && (
          <p className="hint">段階がありません（場を使わないドロー系になります）。</p>
        )}
        {structure.streets.length > 0 && <div className="street-columns" aria-hidden="true"><span>名前</span><span>開く</span><span>焼く</span><span /></div>}
        <ul className="street-list">
          {structure.streets.map((street, i) => (
            <li key={i} className="street-row">
              <div className="street-name"><EditableText compact label={`${i + 1}番目の段階の名前`} value={street.name} maxLength={12} onChange={name => setStreet(i, { name })} /></div>
              {/* data-label は狭い画面で列の見出しの代わりに出す */}
              <div className="street-num" data-label="開く"><Stepper hideLabel label={`${street.name}で開く枚数`} value={street.cards} min={0} max={10} onChange={value => setStreet(i, { cards: value })} /></div>
              <div className="street-num" data-label="焼く"><Stepper hideLabel label={`${street.name}で焼く枚数`} value={street.burn ?? 0} min={0} max={10} onChange={value => setStreet(i, { burn: value })} /></div>
              <button
                type="button"
                className="btn btn-ghost street-remove"
                aria-label={`${street.name} を消す`}
                onClick={() => removeStreet(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost" onClick={addStreet}>
          <Icon kind="plus" />段階を足す
        </button>
        <p className="hint">バーンの枚数も必要なデッキ枚数に含めます。</p>
      </details>
    </section>
  );
}

interface UsageFieldProps {
  readonly label: string;
  readonly usage: UsageRange | undefined;
  readonly limit: number;
  readonly onChange: (usage: UsageRange | undefined) => void;
}

/** 「自由 / ちょうどN枚」の切り替え。範囲指定は使う場面が少ないので畳んである。 */
function UsageField({ label, usage, limit, onChange }: UsageFieldProps) {
  const exact = usage !== undefined && usage.min === usage.max;

  return (
    <div className="field usage-field">
      <span className="field-label">{label}</span>
      <div className="usage-controls">
        <select className="input usage-mode" aria-label={`${label}の条件`} value={usage === undefined ? 'free' : exact ? 'exact' : 'range'} onChange={event => {
          onChange(event.target.value === 'free' ? undefined : event.target.value === 'exact' ? { min: Math.min(2, limit), max: Math.min(2, limit) } : { min: 0, max: limit });
        }}><option value="free">自由</option><option value="exact">ちょうど</option><option value="range">範囲</option></select>
      {usage !== undefined && exact && (
        <Stepper hideLabel label={`${label}（ちょうど）`} suffix="枚" value={usage.min} min={0} max={limit} onChange={n => onChange({ min: n, max: n })} />
      )}

      {usage !== undefined && !exact && (
        <>
          <Stepper hideLabel label={`${label}の下限`} value={usage.min} min={0} max={usage.max} onChange={min => onChange({ ...usage, min })} />
          <span aria-hidden="true">〜</span>
          <Stepper hideLabel label={`${label}の上限`} value={usage.max} min={usage.min} max={limit} onChange={max => onChange({ ...usage, max })} />
        </>
      )}

      </div>
    </div>
  );
}


function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
