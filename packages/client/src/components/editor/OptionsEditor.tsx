import type { ShowCardsPolicy, TableOptions } from '@wildcard/engine';

interface OptionsEditorProps {
  readonly options: TableOptions | undefined;
  readonly onChange: (options: TableOptions) => void;
}

const SHOW_CARDS: readonly { readonly value: ShowCardsPolicy; readonly label: string }[] = [
  { value: 'none', label: '見せない' },
  { value: 'one', label: '1枚だけ' },
  { value: 'any', label: '好きなだけ' },
];

/**
 * 卓の作法。勝敗の判定には関わらないが、場の雰囲気を決めるもの。
 *
 * 露出とミスディールは別物として扱っている。1枚だけ表にしてしまったのは
 * ミスディールではなく、回収して引き直す手順になる（→ docs/variants.md）。
 */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

export function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  const set = (patch: Partial<TableOptions>) => onChange({ ...options, ...patch });
  const percent = (value: number | undefined) => Math.round((value ?? 0) * 100);

  return (
    <section className="panel">
      <h2 className="panel-title">卓の作法</h2>

      <label className="field">
        <span className="field-label">
          ディーラーが1枚だけ表にしてしまう（{percent(options?.exposedCardChance)}%）
        </span>
        <input
          className="range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent(options?.exposedCardChance)}
          onChange={(e) => set({ exposedCardChance: Number(e.target.value) / 100 })}
        />
        <p className="hint">
          ミスディールではありません。表になった札は回収して山札の上から引き直し、
          その札をフロップのバーンに使います。手札は割れません。
        </p>
      </label>

      <label className="checkline">
        <input
          type="checkbox"
          checked={options?.exposedCardBecomesBurn ?? false}
          onChange={(e) => set({ exposedCardBecomesBurn: e.target.checked })}
        />
        <span>
          露出した札をバーンに使う
          <small className="checkline-note">
            外すと、露出とは別にバーンを取ります（ハウスによって流儀が違うところ）。
            必要なデッキ枚数が1枚増えます。
          </small>
        </span>
      </label>

      <label className="field">
        <span className="field-label">
          ミスディール（{percent(options?.misdealChance)}%）
        </span>
        <input
          className="range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent(options?.misdealChance)}
          onChange={(e) => set({ misdealChance: Number(e.target.value) / 100 })}
        />
        <p className="hint">2枚以上表になった場合。手札を回収して最初から配り直します。</p>
      </label>

      <div className="field">
        <span className="field-label">オールイン決着で走らせる本数</span>
        <div className="segmented">
          {[1, 2, 3].map((runs) => (
            <button
              key={runs}
              type="button"
              className={`segment ${(options?.runItTwice?.max ?? 1) === runs ? 'segment-active' : ''}`}
              onClick={() =>
                // 1本は「しない」こと。項目ごと消しておくと、
                // 書き出した JSON に意味の無い設定が残らない。
                onChange(
                  runs === 1
                    ? omit({ ...options }, 'runItTwice')
                    : { ...options, runItTwice: { max: runs } },
                )
              }
            >
              {runs}本
            </button>
          ))}
        </div>
        <p className="hint">
          全員がオールインしたあと、残りの札を複数回めくってポットを分けます。
          全員の同意が要ります（1人でも断れば1本）。必要なデッキ枚数が本数ぶん増えます。
        </p>
      </div>

      <label className="checkline">
        <input
          type="checkbox"
          checked={options?.rabbitHunt ?? false}
          onChange={(e) => set({ rabbitHunt: e.target.checked })}
        />
        <span>
          ラビットハント
          <small className="checkline-note">
            降りて終わったあと、開かれるはずだった札を見られます。
          </small>
        </span>
      </label>

      <div className="field">
        <span className="field-label">自分の手札を見せる</span>
        <div className="segmented">
          {SHOW_CARDS.map((policy) => (
            <button
              key={policy.value}
              type="button"
              className={`segment ${
                (options?.showCards ?? 'none') === policy.value ? 'segment-active' : ''
              }`}
              onClick={() => set({ showCards: policy.value })}
            >
              {policy.label}
            </button>
          ))}
        </div>
        <p className="hint">降ろしたあとに手札を公開できます。1枚だけ見せるのも駆け引きです。</p>
      </div>
    </section>
  );
}
