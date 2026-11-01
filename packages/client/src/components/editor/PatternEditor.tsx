import { useRef, useState } from 'react';
import { Icon } from '../Icon.js';
import { Stepper } from '../Stepper.js';
import { withExcluded } from './DeckEditor.js';
import { InfoTip } from '../InfoTip.js';
import {
  COLOR_SUITS,
  RANKS,
  SUITS,
  blockSize,
  fromBlocks,
  toBlocks,
  type BlockSuit,
  type CardColor,
  type GlobalCondition,
  type HandPattern,
  type PatternBlock,
  type Rank,
  type Suit,
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

const SUIT_MARK: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/** まとまりのスートの選択肢。「その他」は1枚ずつのスートの組が他に当てはまらないとき。 */
type SuitChoice = 'none' | 'same' | 'red' | 'black' | Suit | 'other';
const SUIT_CHOICES: readonly (readonly [SuitChoice, string])[] = [
  ['none', '指定なし'], ['same', '同じスート'], ['red', '赤'], ['black', '黒'],
  ['spades', '♠ だけ'], ['hearts', '♥ だけ'], ['diamonds', '♦ だけ'], ['clubs', '♣ だけ'],
];

function suitChoiceOf(suit: BlockSuit | undefined): SuitChoice {
  if (!suit) return 'none';
  if (suit.kind === 'same') return 'same';
  const set = SUITS.filter((s) => suit.suits.includes(s));
  if (set.length === 1) return set[0]!;
  for (const color of ['red', 'black'] as const) {
    if (set.length === 2 && COLOR_SUITS[color].every((s) => set.includes(s))) return color;
  }
  return 'other';
}

function suitFromChoice(choice: SuitChoice, previous: BlockSuit | undefined): BlockSuit | undefined {
  switch (choice) {
    case 'none': return undefined;
    case 'same': return { kind: 'same' };
    case 'red': case 'black': return { kind: 'in', suits: [...COLOR_SUITS[choice]] };
    case 'other': return previous;
    default: return { kind: 'in', suits: [choice] };
  }
}

/**
 * 役の条件の編集。
 *
 * 1枚ずつではなく**まとまり**で組む。フルハウスは「3枚組と2枚組」であって
 * `X X X Y Y` ではない。変数名は engine の blocks.ts が振るので、
 * ここには出てこない。
 *
 * まとまりごとにスート（同じスート・色・特定のスート）を決められ、連続には
 * 間隔・回り込み・前のまとまりからの続きがある。全体の条件はランク・スート・色に分けて並べる。
 */
export function PatternEditor({ pattern, handSize, ranks, onChange }: PatternEditorProps) {
  const blocks = toBlocks(pattern);
  // まとまりの追加・削除を動かして見せるため、まとまりごとに変わらない鍵を持つ。
  // 外から形が変わった（数が合わない）ときは振り直す。
  const keys = useRef<number[]>([]);
  const nextKey = useRef(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [entering, setEntering] = useState<number | null>(null);
  if (blocks && keys.current.length !== blocks.length) keys.current = blocks.map(() => nextKey.current++);

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

  const removeAt = (i: number) => {
    keys.current.splice(i, 1);
    // 消したまとまりに続いていた連続は、続ける先が無くなるので独立させる。
    const next = blocks.filter((_, at) => at !== i).map((b, at) =>
      b.kind === 'run' && b.continues && (at === 0 || blocks.filter((_, k) => k !== i)[at - 1]?.kind !== 'run') ? omit(b, 'continues') : b);
    emit(next);
  };

  const used = blocks.reduce((sum, block) => sum + blockSize(block), 0);
  const global = pattern.global;
  const has = (type: GlobalCondition['type']) => global.some((g) => g.type === type);
  const setGlobal = (type: GlobalCondition['type'], next: GlobalCondition | null) =>
    emit(blocks, next === null ? global.filter((g) => g.type !== type) : has(type) ? global.map((g) => (g.type === type ? next : g)) : [...global, next]);
  const toggle = (type: GlobalCondition['type'], make: () => GlobalCondition) => setGlobal(type, has(type) ? null : make());
  const consecutive = global.find((g) => g.type === 'consecutive');
  const suitCount = global.find((g) => g.type === 'suitCount');
  const suitKinds = global.find((g) => g.type === 'suitKinds');
  const color = global.find((g) => g.type === 'color');
  const colorCounts = global.filter((g) => g.type === 'colorCount');
  const colorCountOf = (c: CardColor) => colorCounts.find((g) => g.type === 'colorCount' && g.color === c);
  const setColorCount = (c: CardColor, count: number | null) => {
    const others = global.filter((g) => !(g.type === 'colorCount' && g.color === c));
    emit(blocks, count === null ? others : [...others, { type: 'colorCount', color: c, count }]);
  };

  return (
    <div className="pattern-editor">
      <div className="pattern-head">
        <span className="field-label">条件<InfoTip label="条件">同じランク・連続などのまとまりを組み合わせて役を作ります。条件より役の枚数が多いとき、残りはキッカーです。連続の「回り込み」は Q K A 2 3 のように端をまたぐ並び、「前に続ける」は直前の連続の続きとして数えます（3枚と2枚で別のスート、など）。スートの「同じスート」は、そのまとまりの札が同じスートで、別の「同じスート」のまとまりとは違うスートになります。</InfoTip></span>
        <small className={`block-total ${used > handSize ? 'block-total-bad' : ''}`}>
          {used}枚 / 役は{handSize}枚
          {used > handSize && '（多すぎて成立しません）'}
          {used < handSize && `（残り${handSize - used}枚はキッカー）`}
        </small>
      </div>

      {blocks.length > 0 && <div className="block-columns" aria-hidden="true"><span>まとまり</span><span>枚数</span><span>ランク・並び</span><span>スート</span><span /></div>}
      <ul className="block-list">
        {blocks.map((block, i) => {
          const previous = blocks[i - 1];
          const suitChoice = suitChoiceOf(block.suit);
          return (
          <li key={keys.current[i]} className={`block-row ${leaving === keys.current[i] ? 'block-row-leaving' : ''} ${entering === keys.current[i] ? 'block-row-entering' : ''}`}
            onAnimationEnd={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.animationName === 'block-leave') { setLeaving(null); removeAt(i); }
              if (event.animationName === 'block-enter') setEntering(null);
            }}>
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
            <div className={`block-ranks-cell ${block.kind === 'fixed' || block.kind === 'oneOf' || block.kind === 'run' ? '' : 'block-ranks-none'}`} data-label={block.kind === 'run' ? '並び' : 'ランク'}>
              {block.kind === 'fixed' || block.kind === 'oneOf'
                ? <RankChips ranks={ranks} selected={block.ranks} onChange={(next) => setBlock(i, { ...block, ranks: next })} />
                : block.kind === 'run'
                  ? <div className="run-options">
                    <select className="input run-step" aria-label={`${i + 1}つめのまとまりの間隔`} value={block.step ?? 1}
                      onChange={(e) => { const step = Number(e.target.value); setBlock(i, step === 1 ? omit(block, 'step') : { ...block, step }); }}>
                      <option value={1}>続けて</option>
                      <option value={2}>1つ飛ばし</option>
                      <option value={3}>2つ飛ばし</option>
                    </select>
                    <label className="checkline"><input type="checkbox" checked={block.wrap === true} onChange={(e) => setBlock(i, e.target.checked ? { ...block, wrap: true } : omit(block, 'wrap'))} /><span>回り込み</span></label>
                    {previous?.kind === 'run' && <label className="checkline"><input type="checkbox" checked={block.continues === true} onChange={(e) => setBlock(i, e.target.checked ? { ...block, continues: true } : omit(block, 'continues'))} /><span>前に続ける</span></label>}
                  </div>
                  : <span className="block-ranks-free" aria-hidden="true">—</span>}
            </div>

            <div className="block-suit-cell" data-label="スート">
              <select className={`input block-suit ${suitChoice === 'none' ? 'block-suit-none' : ''}`} aria-label={`${i + 1}つめのまとまりのスート`} value={suitChoice}
                onChange={(e) => { const suit = suitFromChoice(e.target.value as SuitChoice, block.suit); setBlock(i, suit === undefined ? withoutSuit(block) : { ...block, suit }); }}>
                {SUIT_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                {suitChoice === 'other' && block.suit?.kind === 'in' && <option value="other">{block.suit.suits.map((s) => SUIT_MARK[s]).join('')}</option>}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-ghost block-remove"
              aria-label={`${i + 1}つめのまとまりを消す`}
              disabled={leaving !== null}
              onClick={() => {
                // 動きを止める設定なら、すぐ消す
                if (matchMedia('(prefers-reduced-motion: reduce)').matches) removeAt(i);
                else setLeaving(keys.current[i]!);
              }}
            >
              ×
            </button>
          </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          const key = nextKey.current++;
          keys.current = [...keys.current, key];
          setEntering(key);
          emit([...blocks, { kind: 'sameRank', count: 2 }]);
        }}
      >
        <Icon kind="plus" />まとまりを足す
      </button>

      <span className="field-label pattern-global-label">全体の条件<InfoTip label="全体の条件">まとまりに当てはまった札全体にかかる条件です。キッカーは含みません。</InfoTip></span>
      <div className="pattern-global-groups">
        <GlobalGroup label="ランク">
          <span className="pattern-param">
            <Chip on={!!consecutive} onClick={() => toggle('consecutive', () => ({ type: 'consecutive' }))}>ランクが連続</Chip>
            {consecutive?.type === 'consecutive' && <label className="checkline"><input type="checkbox" checked={consecutive.wrap === true}
              onChange={(e) => setGlobal('consecutive', e.target.checked ? { type: 'consecutive', wrap: true } : { type: 'consecutive' })} /><span>回り込み</span></label>}
          </span>
          <Chip on={has('allDifferentRank')} onClick={() => toggle('allDifferentRank', () => ({ type: 'allDifferentRank' }))}>すべて違うランク</Chip>
        </GlobalGroup>
        <GlobalGroup label="スート">
          <Chip on={has('allSameSuit')} onClick={() => toggle('allSameSuit', () => ({ type: 'allSameSuit' }))}>すべて同じスート</Chip>
          <Chip on={has('allDifferentSuit')} onClick={() => toggle('allDifferentSuit', () => ({ type: 'allDifferentSuit' }))}>すべて違うスート</Chip>
          <span className="pattern-param">
            <Chip on={!!suitCount} onClick={() => toggle('suitCount', () => ({ type: 'suitCount', count: 3 }))}>同じスートが{suitCount?.type === 'suitCount' ? suitCount.count : 'N'}枚以上</Chip>
            {suitCount?.type === 'suitCount' && <Stepper hideLabel label="同じスートの枚数" suffix="枚" value={suitCount.count} min={2} max={handSize} onChange={(count) => setGlobal('suitCount', { type: 'suitCount', count })} />}
          </span>
          <span className="pattern-param">
            <Chip on={!!suitKinds} onClick={() => toggle('suitKinds', () => ({ type: 'suitKinds', count: 4 }))}>スートが{suitKinds?.type === 'suitKinds' ? suitKinds.count : 'N'}種類以上</Chip>
            {suitKinds?.type === 'suitKinds' && <Stepper hideLabel label="スートの種類" suffix="種" value={suitKinds.count} min={2} max={4} onChange={(count) => setGlobal('suitKinds', { type: 'suitKinds', count })} />}
          </span>
        </GlobalGroup>
        <GlobalGroup label="色">
          <Chip on={has('allSameColor')} onClick={() => toggle('allSameColor', () => ({ type: 'allSameColor' }))}>すべて同じ色</Chip>
          {(['red', 'black'] as const).map((c) => <Chip key={c} on={color?.type === 'color' && color.color === c}
            onClick={() => setGlobal('color', color?.type === 'color' && color.color === c ? null : { type: 'color', color: c })}>すべて{c === 'red' ? '赤' : '黒'}</Chip>)}
          {(['red', 'black'] as const).map((c) => {
            const current = colorCountOf(c);
            return <span key={c} className="pattern-param">
              <Chip on={!!current} onClick={() => setColorCount(c, current ? null : 3)}>{c === 'red' ? '赤' : '黒'}が{current?.type === 'colorCount' ? current.count : 'N'}枚以上</Chip>
              {current?.type === 'colorCount' && <Stepper hideLabel label={`${c === 'red' ? '赤' : '黒'}の枚数`} suffix="枚" value={current.count} min={1} max={handSize} onChange={(count) => setColorCount(c, count)} />}
            </span>;
          })}
        </GlobalGroup>
      </div>
    </div>
  );
}

function GlobalGroup({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return <div className="pattern-global-group" role="group" aria-label={label}><span>{label}</span><div className="chips">{children}</div></div>;
}

function Chip({ on, onClick, children }: { readonly on: boolean; readonly onClick: () => void; readonly children: React.ReactNode }) {
  return <button type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : ''}`} onClick={onClick}>{children}</button>;
}

/**
 * ランクの選択。決まったランクを並べるときと、候補を決めるときに使う。
 *
 * デッキで外したランクも出す（点線）。ここはルールの定義なので、デッキの都合で
 * 選べなくなるのはおかしい。選んで札が無ければ「成立する手が見つかりません」になる。
 * 並びはデッキの画面と同じく左が強い。
 *
 * 「範囲」を押してから2つのランクを押すと、その間をまとめて選ぶ（J〜K で J・Q・K）。
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
  const [range, setRange] = useState<'off' | 'start' | Rank>('off');
  // 弱い順で持つ（エンジンの並びと同じ）。選んだ順に並ぶと読みにくい。
  const ordered = (set: ReadonlySet<Rank>) => [...all].reverse().filter((r) => set.has(r));
  const press = (rank: Rank) => {
    if (range === 'start') { setRange(rank); return; }
    if (range !== 'off') {
      const [a, b] = [all.indexOf(range), all.indexOf(rank)].sort((x, y) => x - y);
      onChange(ordered(new Set([...selected, ...all.slice(a, b! + 1)])));
      setRange('off');
      return;
    }
    onChange(selected.includes(rank) ? selected.filter((r) => r !== rank) : ordered(new Set([...selected, rank])));
  };
  return (
    <div className="chips chips-ranks">
      {all.map((rank) => (
        <button
          key={rank}
          type="button"
          aria-pressed={selected.includes(rank)}
          aria-label={ranks.includes(rank) ? rank : `${rank}（デッキに無い）`}
          className={`chip chip-sm ${selected.includes(rank) ? 'chip-on' : ''} ${ranks.includes(rank) ? '' : 'chip-missing'} ${range === rank ? 'chip-anchor' : ''}`}
          onClick={() => press(rank)}
        >
          {rank}
        </button>
      ))}
      <button type="button" className={`chip chip-sm chip-range ${range !== 'off' ? 'chip-on' : ''}`} aria-pressed={range !== 'off'}
        onClick={() => setRange(range === 'off' ? 'start' : 'off')}>
        {range === 'off' ? '範囲' : range === 'start' ? '始めを選ぶ' : '終わりを選ぶ'}
      </button>
      {selected.length > 0 && <button type="button" className="chip chip-sm chip-range" onClick={() => onChange([])}>解除</button>}
    </div>
  );
}

/** 種類を変えても、枚数・候補・スートはできるだけ引き継ぐ。 */
function convert(block: PatternBlock, kind: PatternBlock['kind']): PatternBlock {
  const count = blockSize(block);
  const suit = block.suit ? { suit: block.suit } : {};
  switch (kind) {
    case 'sameRank':
      return { kind: 'sameRank', count, ...suit };
    case 'run':
      return { kind: 'run', count, ...suit };
    case 'any':
      return { kind: 'any', count, ...suit };
    case 'fixed':
      return { kind: 'fixed', ranks: block.kind === 'oneOf' ? [...block.ranks] : [], ...suit };
    case 'oneOf':
      return { kind: 'oneOf', ranks: block.kind === 'fixed' ? [...block.ranks] : [], count, ...suit };
  }
}

/** スートの指定を外す（種類ごとの形は保つ）。 */
function withoutSuit(block: PatternBlock): PatternBlock {
  const { suit: _removed, ...rest } = block;
  return rest as PatternBlock;
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
