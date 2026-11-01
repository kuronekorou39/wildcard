import { Icon } from '../Icon.js';
import { Stepper } from '../Stepper.js';
import { withExcluded } from './DeckEditor.js';
import { InfoTip } from '../InfoTip.js';
import {
  RANKS,
  blockSize,
  fromBlocks,
  toBlocks,
  type GlobalCondition,
  type HandPattern,
  type PatternBlock,
  type Rank,
} from '@wildcard/engine';

interface PatternEditorProps {
  readonly pattern: HandPattern;
  readonly handSize: number;
  readonly ranks: readonly Rank[];
  readonly onChange: (pattern: HandPattern) => void;
}

const KINDS: readonly { readonly kind: PatternBlock['kind']; readonly label: string }[] = [
  { kind: 'sameRank', label: '同じランク' },
  { kind: 'run', label: '連続' },
  { kind: 'fixed', label: '決まったランク' },
  { kind: 'oneOf', label: '候補から' },
  { kind: 'any', label: '任意' },
];

const GLOBALS: readonly { readonly type: GlobalCondition['type']; readonly label: string }[] = [
  { type: 'allSameSuit', label: 'すべて同じスート' },
  { type: 'allDifferentSuit', label: 'すべて違うスート' },
  { type: 'consecutive', label: 'ランクが連続' },
  { type: 'allDifferentRank', label: 'すべて違うランク' },
];

/**
 * 役の条件の編集。
 *
 * 1枚ずつではなく**まとまり**で組む。フルハウスは「3枚組と2枚組」であって
 * `X X X Y Y` ではない。変数名は engine の blocks.ts が振るので、
 * ここには出てこない。
 */
export function PatternEditor({ pattern, handSize, ranks, onChange }: PatternEditorProps) {
  const blocks = toBlocks(pattern);

  if (!blocks) {
    // 戻せない形。黙って近い形に直すと、開いただけで役が変わってしまう。
    return (
      <div className="field">
        <span className="field-label">条件</span>
        <p className="hint hint-warn">
          この役には1枚ずつの細かい指定が入っているため、ここでは編集できません。
          書き出して直接編集してください。
        </p>
      </div>
    );
  }

  const emit = (next: readonly PatternBlock[], global = pattern.global) =>
    onChange(fromBlocks(next, global));

  const setBlock = (at: number, block: PatternBlock) =>
    emit(blocks.map((b, i) => (i === at ? block : b)));

  const used = blocks.reduce((sum, block) => sum + blockSize(block), 0);

  const toggleGlobal = (type: GlobalCondition['type']) => {
    const has = pattern.global.some((g) => g.type === type);
    emit(
      blocks,
      has
        ? pattern.global.filter((g) => g.type !== type)
        : [...pattern.global, { type } as GlobalCondition],
    );
  };

  const suitCount = pattern.global.find((g) => g.type === 'suitCount');

  return (
    <div className="pattern-editor">
      <div className="pattern-head">
        <span className="field-label">条件<InfoTip label="条件">同じランク・連続などのまとまりを組み合わせて役を作ります。条件より役の枚数が多いとき、残りはキッカーです。</InfoTip></span>
        <small className={`block-total ${used > handSize ? 'block-total-bad' : ''}`}>
          {used}枚 / 役は{handSize}枚
          {used > handSize && '（多すぎて成立しません）'}
          {used < handSize && `（残り${handSize - used}枚はキッカー）`}
        </small>
      </div>

      {blocks.length > 0 && <div className="block-columns" aria-hidden="true"><span>まとまり</span><span>枚数</span><span>ランク</span><span /></div>}
      <ul className="block-list">
        {blocks.map((block, i) => (
          <li key={i} className="block-row">
            <select
              className="input block-kind"
              value={block.kind}
              aria-label={`${i + 1}つめのまとまりの種類`}
              onChange={(e) => setBlock(i, convert(block, e.target.value as PatternBlock['kind']))}
            >
              {KINDS.map((kind) => (
                <option key={kind.kind} value={kind.kind}>
                  {kind.label}
                </option>
              ))}
            </select>

            <div className="block-count-cell" data-label="枚数">
              {block.kind === 'fixed'
                // 決まったランクは、選んだランクの数がそのまま枚数
                ? <span className="block-count-fixed">{block.ranks.length}<small>枚</small></span>
                : <Stepper
                  hideLabel
                  label={`${i + 1}つめのまとまりの枚数`}
                  suffix="枚"
                  value={block.count}
                  min={1}
                  max={handSize}
                  onChange={(count) => setBlock(i, { ...block, count })}
                />}
            </div>

            {/* ランクを選ばない種類では空にする（狭い画面では列ごと隠す） */}
            <div className={`block-ranks-cell ${block.kind === 'fixed' || block.kind === 'oneOf' ? '' : 'block-ranks-none'}`} data-label="ランク">
              {block.kind === 'fixed' || block.kind === 'oneOf'
                ? <RankChips ranks={ranks} selected={block.ranks} onChange={(next) => setBlock(i, { ...block, ranks: next })} />
                : <span className="block-ranks-free" aria-hidden="true">—</span>}
            </div>

            <button
              type="button"
              className="btn btn-ghost block-remove"
              aria-label={`${i + 1}つめのまとまりを消す`}
              onClick={() => emit(blocks.filter((_, at) => at !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => emit([...blocks, { kind: 'sameRank', count: 2 }])}
      >
        <Icon kind="plus" />まとまりを足す
      </button>

      <span className="field-label pattern-global-label">全体の条件</span>
      <div className="chips pattern-globals">
        {GLOBALS.map((global) => (
          <button
            key={global.type}
            type="button"
            aria-pressed={pattern.global.some((g) => g.type === global.type)}
            className={`chip ${pattern.global.some((g) => g.type === global.type) ? 'chip-on' : ''}`}
            onClick={() => toggleGlobal(global.type)}
          >
            {global.label}
          </button>
        ))}
        <span className="pattern-suit-count">
          <button
            type="button"
            aria-pressed={suitCount !== undefined}
            className={`chip ${suitCount ? 'chip-on' : ''}`}
            onClick={() =>
              emit(
                blocks,
                suitCount
                  ? pattern.global.filter((g) => g.type !== 'suitCount')
                  : [...pattern.global, { type: 'suitCount', count: 3 }],
              )
            }
          >
            同じスートが{suitCount?.type === 'suitCount' ? suitCount.count : 'N'}枚以上
          </button>
          {suitCount?.type === 'suitCount' && (
            <Stepper
              hideLabel
              label="同じスートの枚数"
              suffix="枚"
              value={suitCount.count}
              min={2}
              max={handSize}
              onChange={(count) =>
                emit(
                  blocks,
                  pattern.global.map((g) => (g.type === 'suitCount' ? { type: 'suitCount', count } : g)),
                )
              }
            />
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * ランクの選択。決まったランクを並べるときと、候補を決めるときに使う。
 *
 * デッキで外したランクも出す（点線）。ここはルールの定義なので、デッキの都合で
 * 選べなくなるのはおかしい。選んで札が無ければ「成立する手が見つかりません」になる。
 * 並びはデッキの画面と同じく左が強い。
 */
function RankChips({
  ranks,
  selected,
  onChange,
}: {
  readonly ranks: readonly Rank[];
  readonly selected: readonly Rank[];
  readonly onChange: (ranks: Rank[]) => void;
}) {
  const all = withExcluded([...ranks].reverse(), RANKS);
  return (
    <div className="chips chips-ranks">
      {all.map((rank) => (
        <button
          key={rank}
          type="button"
          aria-pressed={selected.includes(rank)}
          aria-label={ranks.includes(rank) ? rank : `${rank}（デッキに無い）`}
          className={`chip chip-sm ${selected.includes(rank) ? 'chip-on' : ''} ${ranks.includes(rank) ? '' : 'chip-missing'}`}
          onClick={() =>
            onChange(
              selected.includes(rank)
                ? selected.filter((r) => r !== rank)
                : // 弱い順で持つ（エンジンの並びと同じ）。選んだ順に並ぶと読みにくい。
                  [...all].reverse().filter((r) => selected.includes(r) || r === rank),
            )
          }
        >
          {rank}
        </button>
      ))}
    </div>
  );
}

/** 種類を変えても、枚数や候補はできるだけ引き継ぐ。 */
function convert(block: PatternBlock, kind: PatternBlock['kind']): PatternBlock {
  const count = blockSize(block);
  switch (kind) {
    case 'sameRank':
      return { kind: 'sameRank', count };
    case 'run':
      return { kind: 'run', count };
    case 'any':
      return { kind: 'any', count };
    case 'fixed':
      return { kind: 'fixed', ranks: block.kind === 'oneOf' ? [...block.ranks] : [] };
    case 'oneOf':
      return { kind: 'oneOf', ranks: block.kind === 'fixed' ? [...block.ranks] : [], count };
  }
}

