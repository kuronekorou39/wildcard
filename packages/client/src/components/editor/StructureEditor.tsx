import { useState } from 'react';
import { EditableText } from '../EditableValue.js';
import { Stepper } from '../Stepper.js';
import { Icon } from '../Icon.js';
import { PlayingCard } from '../PlayingCard.js';
import { boardSize, boardUsageOf, holeUsageOf, type HandStructure, type Street, type UsageRange } from '@wildcard/engine';

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
      <StructurePreview structure={structure} />

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
              {/* 焼く枚数は 0 か 1 がほとんど。開く枚数と見分けられるよう、小さく薄く出す */}
              <div className="street-num street-burn" data-label="焼く"><Stepper hideLabel label={`${street.name}で焼く枚数`} value={street.burn ?? 0} min={0} max={10} onChange={value => setStreet(i, { burn: value })} /></div>
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

/** 図に並べる札の上限。これを超える分は「＋N」で示す。 */
const PREVIEW_CARDS = 12;

/**
 * 配り方の図。ゲーム画面と同じ裏向きの札で、手札と場（段階ごと・焼く札つき）を並べる。
 * その下に役の作り方の例を、手札を一番多く使う形と一番少なく使う形の2つまで出す。
 */
function StructurePreview({ structure }: { readonly structure: HandStructure }) {
  const board = boardSize(structure);
  // 手札から使う枚数 h は、両方の制約と実際の枚数で挟まれる（engine の evaluateHand と同じ計算）。
  const hole = holeUsageOf(structure), fromBoard = boardUsageOf(structure);
  const low = Math.max(0, hole.min, structure.handSize - fromBoard.max, structure.handSize - board);
  const high = Math.min(hole.max, structure.handSize - fromBoard.min, structure.holeCards, structure.handSize);
  const patterns = low > high ? [] : low === high ? [high] : [high, low];
  return <div className="structure-preview" aria-label="配り方の図">
    <div className="structure-preview-line">
      <span className="structure-preview-label">手札</span>
      <Backs count={structure.holeCards} />
    </div>
    <div className="structure-preview-line">
      <span className="structure-preview-label">場</span>
      {structure.streets.length === 0 ? <span className="hint">なし</span> : <span className="structure-streets">
        {structure.streets.map((street, i) => <span key={i} className="structure-street" title={street.name}>
          {(street.burn ?? 0) > 0 && <span className="structure-burn" aria-label={`${street.name}の前に${street.burn}枚焼く`}><Backs count={street.burn ?? 0} /></span>}
          <Backs count={street.cards} />
          <small>{street.name}</small>
        </span>)}
      </span>}
    </div>
    <div className="structure-preview-line structure-patterns">
      <span className="structure-preview-label">役の例</span>
      {patterns.length === 0 ? <span className="hint hint-warn">この組み合わせでは役を作れません</span> : <span className="structure-pattern-list">
        {patterns.map((h) => <span key={h} className="structure-pattern">
          <span className="structure-slots" aria-hidden="true">
            {Array.from({ length: structure.handSize }, (_, i) => <i key={i} data-from={i < h ? 'hole' : 'board'}>{i < h ? '手' : '場'}</i>)}
          </span>
          <small>{h === 0 ? `場${structure.handSize - h}枚だけ` : h === structure.handSize ? `手札${h}枚だけ` : `手札${h}＋場${structure.handSize - h}`}</small>
        </span>)}
      </span>}
    </div>
  </div>;
}

function Backs({ count }: { readonly count: number }) {
  const shown = Math.min(count, PREVIEW_CARDS);
  return <span className="structure-backs" role="img" aria-label={`${count}枚`}>
    {Array.from({ length: shown }, (_, i) => <PlayingCard key={i} card={null} size="sm" />)}
    {count > shown && <small>＋{count - shown}</small>}
  </span>;
}

interface UsageFieldProps {
  readonly label: string;
  readonly usage: UsageRange | undefined;
  readonly limit: number;
  readonly onChange: (usage: UsageRange | undefined) => void;
}

type UsageMode = 'free' | 'exact' | 'range';
const USAGE_MODES: readonly (readonly [UsageMode, string])[] = [['free', '自由'], ['exact', 'ちょうど'], ['range', '範囲']];

/**
 * 「自由 / ちょうど / 範囲」の切り替え。数字は切替の下の行に出し、狭い画面でも詰まらない。
 * 範囲で最小と最大が同じになっても「範囲」のまま見せる（勝手に「ちょうど」へ変えない）。
 */
function UsageField({ label, usage, limit, onChange }: UsageFieldProps) {
  const [mode, setMode] = useState<UsageMode>(() => usage === undefined ? 'free' : usage.min === usage.max ? 'exact' : 'range');
  const shown: UsageMode = usage === undefined ? 'free' : mode === 'free' ? (usage.min === usage.max ? 'exact' : 'range') : mode;
  const choose = (next: UsageMode) => {
    setMode(next);
    if (next === 'free') onChange(undefined);
    else if (next === 'exact') { const n = Math.min(usage?.min ?? 2, limit); onChange({ min: n, max: n }); }
    else onChange({ min: usage?.min ?? 0, max: usage === undefined ? limit : Math.max(usage.max, usage.min) });
  };

  return (
    <div className="field usage-field">
      <div className="usage-head">
        <span className="field-label">{label}</span>
        <div className="usage-modes" role="group" aria-label={`${label}の条件`}>
          {USAGE_MODES.map(([id, name]) => <button key={id} type="button" aria-pressed={shown === id} onClick={() => choose(id)}>{name}</button>)}
        </div>
      </div>
      {usage !== undefined && shown === 'exact' && <div className="usage-values">
        <Stepper hideLabel label={`${label}（ちょうど）`} suffix="枚" value={usage.min} min={0} max={limit} onChange={n => onChange({ min: n, max: n })} />
      </div>}
      {usage !== undefined && shown === 'range' && <div className="usage-values">
        <span className="usage-bound"><span>最小</span><Stepper hideLabel label={`${label}の最小`} suffix="枚" value={usage.min} min={0} max={usage.max} onChange={min => onChange({ ...usage, min })} /></span>
        <span className="usage-bound"><span>最大</span><Stepper hideLabel label={`${label}の最大`} suffix="枚" value={usage.max} min={usage.min} max={limit} onChange={max => onChange({ ...usage, max })} /></span>
      </div>}
    </div>
  );
}


function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
