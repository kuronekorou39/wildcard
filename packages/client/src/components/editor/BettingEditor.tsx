import { PREFLOP, STRADDLE_UNLIMITED, type BettingRules, type HandStructure, type LimitKind } from '@wildcard/engine';
import { InfoTip } from '../InfoTip.js';

interface BettingEditorProps {
  readonly betting: BettingRules;
  readonly structure: HandStructure;
  readonly onChange: (betting: BettingRules) => void;
}

/** 説明はボタンのすぐ下に出す。名前だけでは何が違うのか分からない。 */
const LIMITS: readonly { readonly kind: LimitKind; readonly label: string; readonly note: string }[] = [
  { kind: 'no-limit', label: 'ノーリミット', note: '手持ち全部まで賭けられる' },
  { kind: 'pot-limit', label: 'ポットリミット', note: 'ポットの額まで賭けられる' },
  { kind: 'fixed-limit', label: 'フィックスリミット', note: '決まった額ずつ賭ける' },
];

/** 押して選ぶ小さな選択肢。値の数が少ないものはセレクトより一目で分かる。 */
function Choice<T extends number>({ label, value, options, onChange }: {
  readonly label: string; readonly value: T;
  readonly options: readonly (readonly [T, string])[]; readonly onChange: (value: T) => void;
}) {
  return <div className="choice" role="group" aria-label={label}>
    {options.map(([id, name]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{name}</button>)}
  </div>;
}

/**
 * 賭け方の編集。
 *
 * 制度を変えると**同じ役・同じデッキでも別のゲームになる**。
 * ノーリミットのオマハが毎回オールインになるのは有名な話で、
 * だから実際のオマハはポットリミットで行われる。
 *
 * 制度で変わるのは「賭け額が倍になる段階」（フィックスリミットだけ）。
 * それは制度の枠の中に出し、どの制度でも効く設定とは分けて並べる。
 */
export function BettingEditor({ betting, structure, onChange }: BettingEditorProps) {
  const set = (patch: Partial<BettingRules>) => onChange({ ...betting, ...patch });

  const noAllInPreflop = betting.streetCaps?.some((cap) => cap.street === PREFLOP && cap.noAllIn) ?? false;
  const toggleNoAllIn = (on: boolean) => {
    // 他のストリートの上限は触らない。消すのはプリフロップのぶんだけ。
    const others = (betting.streetCaps ?? []).filter((cap) => cap.street !== PREFLOP);
    const next = on ? [...others, { street: PREFLOP, noAllIn: true }] : others;
    onChange(next.length > 0 ? { ...betting, streetCaps: next } : omit(betting, 'streetCaps'));
  };

  return (
    <section className="panel" aria-label="賭け方">
      <div className="betting-group">
        <div className="field">
          <span className="field-label">制度<InfoTip label="制度">ノーリミットのオマハは毎回のようにオールインになりやすいので、オマハはポットリミットで遊ぶのが普通です。</InfoTip></span>
          <div className="segmented limit-choices">
            {LIMITS.map((limit) => (
              <button key={limit.kind} type="button" className={`segment ${betting.limit === limit.kind ? 'segment-active' : ''}`} aria-pressed={betting.limit === limit.kind} onClick={() => set({ limit: limit.kind })}>
                <span>{limit.label}</span>
                <small>{limit.note}</small>
              </button>
            ))}
          </div>
        </div>
        {betting.limit === 'fixed-limit' && <div className="field betting-dependent">
          <span className="field-label">賭け額が倍になる段階<InfoTip label="賭け額が倍になる段階">昔ながらのリミットホールデムはターンから倍になります。</InfoTip></span>
          <Choice
            label="賭け額が倍になる段階"
            value={betting.bigBetFrom ?? -1}
            options={[[-1, '倍にしない'], ...structure.streets.map((street, i) => [i, `${street.name}から`] as const)]}
            onChange={(from) => onChange(from < 0 ? omit(betting, 'bigBetFrom') : { ...betting, bigBetFrom: from })}
          />
        </div>}
      </div>

      <p className="betting-common-title">どの制度でも</p>

      <div className="field">
        <span className="field-label">1ラウンドのレイズ回数<InfoTip label="レイズ回数">フィックスリミットでは4回（ベット＋レイズ3回）が普通です。</InfoTip></span>
        <Choice
          label="1ラウンドのレイズ回数"
          value={betting.maxRaisesPerRound ?? 0}
          options={[[0, '無制限'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]}
          onChange={(max) => onChange(max < 1 ? omit(betting, 'maxRaisesPerRound') : { ...betting, maxRaisesPerRound: max })}
        />
      </div>

      <div className="field">
        <span className="field-label">ストラドル（重ねられる回数）<InfoTip label="ストラドル">BB の左隣が、カードを見ずに倍の賭け金を出せます。出した人がプリフロップで最後に行動するので、順番そのものが変わります。1回だけが一般的で、重ねる（ダブルストラドル）かは卓によります。無制限でもブラインドの席までで止まります。</InfoTip></span>
        <Choice
          label="ストラドル"
          value={Math.min(betting.straddle?.max ?? 0, STRADDLE_UNLIMITED)}
          options={[[0, 'なし'], [1, '1'], [2, '2'], [3, '3'], [STRADDLE_UNLIMITED, '無制限']]}
          onChange={(max) => onChange(max < 1 ? omit(betting, 'straddle') : { ...betting, straddle: { max } })}
        />
      </div>

      <div className="field checkline-field">
        <label className="checkline">
          <input type="checkbox" checked={noAllInPreflop} onChange={(e) => toggleNoAllIn(e.target.checked)} />
          <span>プリフロップはオールイン禁止</span>
        </label>
        <InfoTip label="オールイン禁止">最低1枚は残します。縛るのはレイズだけで、コールは縛りません（縛ると相手のベットに応じられない人が出て勝負が進まなくなります）。</InfoTip>
      </div>
    </section>
  );
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
