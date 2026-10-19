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
    <section className="panel">
      <h2 className="panel-title">配り方</h2>

      <div className="field-row">
        <label className="field">
          <span className="field-label">手札</span>
          <input
            className="input"
            type="number"
            min={0}
            max={20}
            value={structure.holeCards}
            onChange={(e) => set({ holeCards: clamp(e.target.value, 0, 20) })}
          />
        </label>
        <label className="field">
          <span className="field-label">役を作る枚数</span>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            value={structure.handSize}
            onChange={(e) => set({ handSize: clamp(e.target.value, 1, 10) })}
          />
        </label>
      </div>

      <UsageField
        label="手札から使う枚数"
        usage={structure.holeUsage}
        limit={structure.holeCards}
        hint="オマハは「ちょうど2枚」。指定しなければ何枚使ってもかまいません。"
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
        hint="オマハは「ちょうど3枚」。"
        onChange={(boardUsage) =>
          onChange(
            boardUsage === undefined
              ? omit(structure, 'boardUsage')
              : { ...structure, boardUsage },
          )
        }
      />

      <div className="field">
        <span className="field-label">場に開く段階</span>
        {structure.streets.length === 0 && (
          <p className="hint">段階がありません（場を使わないドロー系になります）。</p>
        )}
        <ul className="street-list">
          {structure.streets.map((street, i) => (
            <li key={i} className="street-row">
              <input
                className="input street-name"
                value={street.name}
                maxLength={12}
                aria-label={`${i + 1}番目の段階の名前`}
                onChange={(e) => setStreet(i, { name: e.target.value })}
              />
              <label className="street-num">
                <span>開く</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={street.cards}
                  onChange={(e) => setStreet(i, { cards: clamp(e.target.value, 0, 10) })}
                />
              </label>
              <label className="street-num">
                <span>焼く</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10}
                  value={street.burn ?? 0}
                  onChange={(e) => setStreet(i, { burn: clamp(e.target.value, 0, 10) })}
                />
              </label>
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
          ＋ 段階を足す
        </button>
        <p className="hint">
          「焼く」は開く前に山札から落とす枚数です。確率は変わりませんが、必要な
          デッキ枚数は増えます。
        </p>
      </div>
    </section>
  );
}

interface UsageFieldProps {
  readonly label: string;
  readonly usage: UsageRange | undefined;
  readonly limit: number;
  readonly hint: string;
  readonly onChange: (usage: UsageRange | undefined) => void;
}

/** 「自由 / ちょうどN枚」の切り替え。範囲指定は使う場面が少ないので畳んである。 */
function UsageField({ label, usage, limit, hint, onChange }: UsageFieldProps) {
  const exact = usage !== undefined && usage.min === usage.max;

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented">
        <button
          type="button"
          className={`segment ${usage === undefined ? 'segment-active' : ''}`}
          onClick={() => onChange(undefined)}
        >
          自由
        </button>
        <button
          type="button"
          className={`segment ${exact ? 'segment-active' : ''}`}
          onClick={() => onChange({ min: Math.min(2, limit), max: Math.min(2, limit) })}
        >
          ちょうど
        </button>
        <button
          type="button"
          className={`segment ${usage !== undefined && !exact ? 'segment-active' : ''}`}
          onClick={() => onChange({ min: 0, max: limit })}
        >
          範囲
        </button>
      </div>

      {usage !== undefined && exact && (
        <input
          className="input"
          type="number"
          min={0}
          max={limit}
          value={usage.min}
          aria-label={`${label}（ちょうど）`}
          onChange={(e) => {
            const n = clamp(e.target.value, 0, limit);
            onChange({ min: n, max: n });
          }}
        />
      )}

      {usage !== undefined && !exact && (
        <div className="field-row">
          <input
            className="input"
            type="number"
            min={0}
            max={limit}
            value={usage.min}
            aria-label={`${label}の下限`}
            onChange={(e) => onChange({ ...usage, min: clamp(e.target.value, 0, limit) })}
          />
          <input
            className="input"
            type="number"
            min={0}
            max={limit}
            value={usage.max}
            aria-label={`${label}の上限`}
            onChange={(e) => onChange({ ...usage, max: clamp(e.target.value, 0, limit) })}
          />
        </div>
      )}

      <p className="hint">{hint}</p>
    </div>
  );
}

function clamp(value: string, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
