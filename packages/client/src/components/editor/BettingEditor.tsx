import { PREFLOP, type BettingRules, type HandStructure, type LimitKind } from '@wildcard/engine';

interface BettingEditorProps {
  readonly betting: BettingRules;
  readonly structure: HandStructure;
  readonly onChange: (betting: BettingRules) => void;
}

const LIMITS: readonly { readonly kind: LimitKind; readonly label: string; readonly note: string }[] =
  [
    { kind: 'no-limit', label: 'ノーリミット', note: 'いつでも手持ち全部まで出せます。' },
    {
      kind: 'pot-limit',
      label: 'ポットリミット',
      note: 'コールしたあとのポットぶんまで。オマハはこの形が普通です。',
    },
    {
      kind: 'fixed-limit',
      label: 'フィックスリミット',
      note: '賭け額が刻みで決まります。1回に動く額が小さくなります。',
    },
  ];

/**
 * 賭け方の編集。
 *
 * 制度を変えると**同じ役・同じデッキでも別のゲームになる**。
 * ノーリミットのオマハが毎回オールインになるのは有名な話で、
 * だから実際のオマハはポットリミットで行われる。
 */
export function BettingEditor({ betting, structure, onChange }: BettingEditorProps) {
  const set = (patch: Partial<BettingRules>) => onChange({ ...betting, ...patch });

  const noAllInPreflop = betting.streetCaps?.some(
    (cap) => cap.street === PREFLOP && cap.noAllIn,
  );

  const toggleNoAllIn = (on: boolean) => {
    // 他のストリートの上限は触らない。消すのはプリフロップのぶんだけ。
    const others = (betting.streetCaps ?? []).filter((cap) => cap.street !== PREFLOP);
    const next = on ? [...others, { street: PREFLOP, noAllIn: true }] : others;
    onChange(next.length > 0 ? { ...betting, streetCaps: next } : omit(betting, 'streetCaps'));
  };

  return (
    <section className="panel" aria-label="賭け方">

      <div className="field">
        <span className="field-label">制度</span>
        <div className="segmented">
          {LIMITS.map((limit) => (
            <button
              key={limit.kind}
              type="button"
              className={`segment ${betting.limit === limit.kind ? 'segment-active' : ''}`}
              onClick={() => set({ limit: limit.kind })}
            >
              {limit.label}
            </button>
          ))}
        </div>
        <p className="hint">{LIMITS.find((l) => l.kind === betting.limit)?.note}</p>
      </div>

      {betting.limit === 'fixed-limit' && (
        <label className="field">
          <span className="field-label">賭け額が倍になる段階</span>
          <select
            className="input"
            value={betting.bigBetFrom ?? -1}
            onChange={(e) => {
              const from = Number(e.target.value);
              onChange(from < 0 ? omit(betting, 'bigBetFrom') : { ...betting, bigBetFrom: from });
            }}
          >
            <option value={-1}>倍にしない</option>
            {structure.streets.map((street, i) => (
              <option key={i} value={i}>
                {street.name}から
              </option>
            ))}
          </select>
          <p className="hint">昔ながらのリミットホールデムはターンから倍になります。</p>
        </label>
      )}

      <label className="field">
        <span className="field-label">1ラウンドのレイズ回数</span>
        <select
          className="input"
          value={betting.maxRaisesPerRound ?? 0}
          onChange={(e) => {
            const max = Number(e.target.value);
            onChange(
              max < 1 ? omit(betting, 'maxRaisesPerRound') : { ...betting, maxRaisesPerRound: max },
            );
          }}
        >
          <option value={0}>無制限</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}回まで
            </option>
          ))}
        </select>
        <p className="hint">フィックスリミットでは4回（ベット＋レイズ3回）が普通です。</p>
      </label>

      <label className="field">
        <span className="field-label">ストラドル</span>
        <select
          className="input"
          value={betting.straddle?.max ?? 0}
          onChange={(e) => {
            const max = Number(e.target.value);
            onChange(max < 1 ? omit(betting, 'straddle') : { ...betting, straddle: { max } });
          }}
        >
          <option value={0}>なし</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}回まで重ねられる
            </option>
          ))}
        </select>
        <p className="hint">
          BB の左隣が、カードを見ずに倍の賭け金を出せます。出した人がプリフロップで
          最後に行動するので、順番そのものが変わります。
        </p>
      </label>

      <label className="checkline">
        <input
          type="checkbox"
          checked={noAllInPreflop ?? false}
          onChange={(e) => toggleNoAllIn(e.target.checked)}
        />
        <span>
          プリフロップはオールイン禁止
          <small className="checkline-note">
            最低1枚は残します。縛るのはレイズだけで、コールは縛りません（縛ると
            相手のベットに応じられない人が出て勝負が進まなくなります）。
          </small>
        </span>
      </label>
    </section>
  );
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
