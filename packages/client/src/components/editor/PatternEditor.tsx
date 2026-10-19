import {
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
    <div className="field">
      <span className="field-label">条件（まとまりで組む）</span>

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

            {block.kind === 'fixed' ? (
              <RankChips
                ranks={ranks}
                selected={block.ranks}
                onChange={(next) => setBlock(i, { kind: 'fixed', ranks: next })}
              />
            ) : (
              <label className="block-count">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={handSize}
                  value={block.count}
                  aria-label={`${i + 1}つめのまとまりの枚数`}
                  onChange={(e) =>
                    setBlock(i, { ...block, count: clamp(e.target.value, 1, handSize) })
                  }
                />
                <span>枚</span>
              </label>
            )}

            <button
              type="button"
              className="btn btn-ghost block-remove"
              aria-label={`${i + 1}つめのまとまりを消す`}
              onClick={() => emit(blocks.filter((_, at) => at !== i))}
            >
              ×
            </button>

            {block.kind === 'oneOf' && (
              <RankChips
                ranks={ranks}
                selected={block.ranks}
                onChange={(next) => setBlock(i, { ...block, ranks: next })}
              />
            )}
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => emit([...blocks, { kind: 'sameRank', count: 2 }])}
      >
        ＋ まとまりを足す
      </button>

      <p className={`block-total ${used > handSize ? 'block-total-bad' : ''}`}>
        条件 {used}枚 / 役は {handSize}枚
        {used > handSize && '（条件のほうが多く、成立しません）'}
        {used < handSize && '（残りはキッカー）'}
      </p>

      <div className="chips">
        {GLOBALS.map((global) => (
          <button
            key={global.type}
            type="button"
            className={`chip ${pattern.global.some((g) => g.type === global.type) ? 'chip-on' : ''}`}
            onClick={() => toggleGlobal(global.type)}
          >
            {global.label}
          </button>
        ))}
        <button
          type="button"
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
          同じスートがN枚以上
        </button>
      </div>

      {suitCount?.type === 'suitCount' && (
        <label className="block-count">
          <input
            className="input"
            type="number"
            min={2}
            max={handSize}
            value={suitCount.count}
            aria-label="同じスートの枚数"
            onChange={(e) =>
              emit(
                blocks,
                pattern.global.map((g) =>
                  g.type === 'suitCount'
                    ? { type: 'suitCount', count: clamp(e.target.value, 2, handSize) }
                    : g,
                ),
              )
            }
          />
          <span>枚以上</span>
        </label>
      )}
    </div>
  );
}

/** ランクの選択。決まったランクを並べるときと、候補を決めるときに使う。 */
function RankChips({
  ranks,
  selected,
  onChange,
}: {
  readonly ranks: readonly Rank[];
  readonly selected: readonly Rank[];
  readonly onChange: (ranks: Rank[]) => void;
}) {
  return (
    <div className="chips chips-ranks">
      {ranks.map((rank) => (
        <button
          key={rank}
          type="button"
          className={`chip chip-sm ${selected.includes(rank) ? 'chip-on' : ''}`}
          onClick={() =>
            onChange(
              selected.includes(rank)
                ? selected.filter((r) => r !== rank)
                : // デッキの並び順に揃える。選んだ順に並ぶと読みにくい。
                  ranks.filter((r) => selected.includes(r) || r === rank),
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

function clamp(value: string, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
