import type { ShowCardsPolicy, TableOptions } from '@wildcard/engine';
import { InfoTip } from '../InfoTip.js';
import { Stepper } from '../Stepper.js';

interface OptionsEditorProps {
  readonly options: TableOptions | undefined;
  readonly onChange: (options: TableOptions) => void;
}

const SHOW_CARDS: readonly { readonly value: ShowCardsPolicy; readonly label: string }[] = [
  { value: 'none', label: '見せない' },
  { value: 'one', label: '1枚だけ' },
  { value: 'any', label: '好きなだけ' },
];

/** 確率の刻み（%）。細かく決めても遊びの差にならない。 */
const PERCENT_STEP = 5;

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}

/** 押して選ぶ小さな選択肢（賭け方と同じ見た目）。 */
function Choice<T extends string | number>({ label, value, options, onChange }: {
  readonly label: string; readonly value: T;
  readonly options: readonly (readonly [T, string])[]; readonly onChange: (value: T) => void;
}) {
  return <div className="choice" role="group" aria-label={label}>
    {options.map(([id, name]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{name}</button>)}
  </div>;
}

/**
 * 卓の作法。勝敗の判定には関わらないが、場の雰囲気を決めるもの。
 *
 * 露出とミスディールは別物として扱っている。1枚だけ表にしてしまったのは
 * ミスディールではなく、回収して引き直す手順になる（→ docs/variants.md）。
 *
 * 「ディーラーのミス」「オールインのあと」「手札の公開」の3つに分けて並べる。
 * 露出した札をバーンに使うかは、露出が起きるとき（0% より大きいとき）だけ意味があるので、その枠の中にだけ出す。
 */
export function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  const set = (patch: Partial<TableOptions>) => onChange({ ...options, ...patch });
  const percent = (value: number | undefined) => Math.round((value ?? 0) * 100);
  const exposed = percent(options?.exposedCardChance);

  return (
    <section className="panel" aria-label="卓の作法">
      <p className="options-group-title">ディーラーのミス</p>
      <div className="options-group">
        <Stepper
          label="1枚だけ表にしてしまう"
          info={<InfoTip label="1枚だけ表にしてしまう">配るときに1枚だけ表になってしまう確率です。ミスディールではなく、表になった札を回収して山札の上から引き直します。手札は割れません。</InfoTip>}
          suffix="%"
          step={PERCENT_STEP}
          value={exposed}
          min={0}
          max={100}
          onChange={(value) => set({ exposedCardChance: value / 100 })}
        />
        {exposed > 0 && <div className="field checkline-field options-dependent">
          <label className="checkline">
            <input type="checkbox" checked={options?.exposedCardBecomesBurn ?? false} onChange={(e) => set({ exposedCardBecomesBurn: e.target.checked })} />
            <span>表になった札をバーンに使う</span>
          </label>
          <InfoTip label="表になった札をバーンに使う">外すと、表になった札とは別にバーンを取ります（ハウスによって流儀が違うところ）。必要なデッキ枚数が1枚増えます。</InfoTip>
        </div>}
        <Stepper
          label="ミスディール"
          info={<InfoTip label="ミスディール">2枚以上表になってしまう確率です。手札を回収して最初から配り直します。</InfoTip>}
          suffix="%"
          step={PERCENT_STEP}
          value={percent(options?.misdealChance)}
          min={0}
          max={100}
          onChange={(value) => set({ misdealChance: value / 100 })}
        />
      </div>

      <p className="options-group-title">オールインのあと</p>
      <div className="options-group">
        <div className="field">
          <span className="field-label">走らせる本数<InfoTip label="走らせる本数">全員がオールインしたあと、残りの札を複数回めくってポットを分けます（ランイットトワイス）。全員の同意が要り、1人でも断れば1本です。必要なデッキ枚数が本数ぶん増えます。</InfoTip></span>
          <Choice
            label="走らせる本数"
            value={options?.runItTwice?.max ?? 1}
            options={[[1, '1本'], [2, '2本まで'], [3, '3本まで']]}
            // 1本は「しない」こと。項目ごと消しておくと、書き出した JSON に意味の無い設定が残らない。
            onChange={(runs) => onChange(runs === 1 ? omit({ ...options }, 'runItTwice') : { ...options, runItTwice: { max: runs } })}
          />
        </div>
      </div>

      <p className="options-group-title">手札の公開</p>
      <div className="options-group">
        <div className="field">
          <span className="field-label">降りたあと自分の手札を見せる<InfoTip label="手札を見せる">降りたあとに手札を公開できます。1枚だけ見せるのも駆け引きです。</InfoTip></span>
          <Choice
            label="自分の手札を見せる"
            value={options?.showCards ?? 'none'}
            options={SHOW_CARDS.map((policy) => [policy.value, policy.label] as const)}
            onChange={(showCards) => set({ showCards })}
          />
        </div>
        <div className="field checkline-field">
          <label className="checkline">
            <input type="checkbox" checked={options?.rabbitHunt ?? false} onChange={(e) => set({ rabbitHunt: e.target.checked })} />
            <span>ラビットハント</span>
          </label>
          <InfoTip label="ラビットハント">降りて勝負が終わったあと、開かれるはずだった場の札を見られます。</InfoTip>
        </div>
      </div>
    </section>
  );
}
