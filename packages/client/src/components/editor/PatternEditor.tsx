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
  ['same', '同じスート'], ['red', '赤'], ['black', '黒'],
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
 * 連続には
 * 間隔・回り込み・前のまとまりからの続きがある。
 *
 * 条件はランクとスートの2つに分ける。ランク条件はまとまりの並び、スート条件は
 * 「全体」か「どのまとまり」にかけるかを選ぶ行の並び。色（赤＝♥♦）はスートの一種として扱う。
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
  const toggle = (type: GlobalCondition['type'], make: () => GlobalCondition) =>
    emit(blocks, has(type) ? global.filter((g) => g.type !== type) : [...global, make()]);
  const consecutive = global.find((g) => g.type === 'consecutive');

  // スート条件の行。全体にかかるもの（global の順）と、まとまりにかかるもの（まとまりの順）。
  const rows: SuitRow[] = [
    ...global.flatMap((g, at): SuitRow[] => (isSuitGlobal(g) ? [{ target: 'all', at, condition: g }] : [])),
    ...blocks.flatMap((b, i): SuitRow[] => (b.suit ? [{ target: i, suit: b.suit }] : [])),
  ];
  const usedSlots = new Set(rows.flatMap((row) => (row.target === 'all' ? [slotOf(globalKey(row.condition))] : [])));
  const freeGlobal = (keep?: string) => GLOBAL_CHOICES.find(([key]) => key === keep || !usedSlots.has(slotOf(key)))?.[0];
  const freeBlock = blocks.findIndex((b) => !b.suit);

  /** 行を差し替える。null で消す。 */
  const replaceRow = (row: SuitRow, next: SuitRow | null) => {
    let nextBlocks = blocks;
    let nextGlobal = global;
    if (row.target === 'all') nextGlobal = global.filter((_, at) => at !== row.at);
    else nextBlocks = blocks.map((b, i) => (i === row.target ? withoutSuit(b) : b));
    if (next?.target === 'all') {
      // 同じ行の中で種類を変えたときは、並びの位置を保つ
      const at = row.target === 'all' ? row.at : nextGlobal.length;
      nextGlobal = [...nextGlobal.slice(0, at), next.condition, ...nextGlobal.slice(at)];
    } else if (next) {
      nextBlocks = nextBlocks.map((b, i) => (i === next.target ? { ...b, suit: next.suit } : b));
    }
    emit(nextBlocks, nextGlobal);
  };
  const retarget = (row: SuitRow, value: string) => {
    if (value === 'all') {
      const key = freeGlobal();
      if (key) replaceRow(row, { target: 'all', at: 0, condition: makeGlobal(key) });
      return;
    }
    replaceRow(row, { target: Number(value), suit: row.target === 'all' ? { kind: 'same' } : row.suit });
  };
  const addRow = () => {
    if (!usedSlots.has('allSameSuit')) emit(blocks, [...global, { type: 'allSameSuit' }]);
    else if (freeBlock >= 0) setBlock(freeBlock, { ...blocks[freeBlock]!, suit: { kind: 'same' } });
    else { const key = freeGlobal(); if (key) emit(blocks, [...global, makeGlobal(key)]); }
  };
  const canAdd = freeBlock >= 0 || freeGlobal() !== undefined;
  const blockLabel = (i: number) => `${i + 1}つめ（${KINDS.find((k) => k.kind === blocks[i]!.kind)!.label}${blockSize(blocks[i]!)}枚）`;

  return (
    <div className="pattern-editor">
      <div className="pattern-head">
        <span className="field-label">ランク条件<InfoTip label="ランク条件">同じランク・連続などのまとまりを組み合わせて役の形を作ります。フルハウスなら「同じランク3枚」と「同じランク2枚」です。条件より役の枚数が多いとき、残りはキッカーです。連続の「回り込み」は Q K A 2 3 のように端をまたぐ並び、「前に続ける」は直前の連続の続きとして数えます（3枚と2枚で別のスート、など）。</InfoTip></span>
        <small className={`block-total ${used > handSize ? 'block-total-bad' : ''}`}>
          {used}枚 / 役は{handSize}枚
          {used > handSize && '（多すぎて成立しません）'}
          {used < handSize && `（残り${handSize - used}枚はキッカー）`}
        </small>
      </div>

      {blocks.length > 0 && <div className="block-columns" aria-hidden="true"><span>まとまり</span><span>枚数</span><span>ランク・並び</span><span /></div>}
      <ul className="block-list">
        {blocks.map((block, i) => {
          const previous = blocks[i - 1];
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
              onChange={(e) => setBlock(i, convert(block, e.target.value as PatternBlock['kind'], ranks))}
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

      <div className="pattern-actions">
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
        <Chip on={has('allDifferentRank')} onClick={() => toggle('allDifferentRank', () => ({ type: 'allDifferentRank' }))}>すべて違うランク</Chip>
        {/* 連続のまとまりと重なるので新しくは足さない。読み込んだ役に入っていたときだけ出して外せるようにする。 */}
        {consecutive && <Chip on onClick={() => toggle('consecutive', () => consecutive)}>全体のランクが連続{consecutive.type === 'consecutive' && consecutive.wrap ? '（回り込み）' : ''}</Chip>}
      </div>

      <span className="field-label pattern-suit-label">スート条件<InfoTip label="スート条件">「全体」は、まとまりに当てはまった札すべてにかかります（キッカーは含みません）。まとまりを選ぶと、そのまとまりの札だけにかかります。まとまりの「同じスート」は、別の「同じスート」のまとまりとは違うスートになります。</InfoTip></span>
      {rows.length > 0 && <ul className="suit-list">
        {rows.map((row) => {
          const key = row.target === 'all' ? `all-${globalKey(row.condition)}` : `block-${keys.current[row.target]}`;
          const where = row.target === 'all' ? '全体' : `${row.target + 1}つめのまとまり`;
          const choice = row.target === 'all' ? null : suitChoiceOf(row.suit);
          const param = row.target === 'all' ? countParam(row.condition, handSize) : null;
          return <li key={key} className="suit-row">
            <select className="input suit-target" aria-label={`${where}のスート条件の対象`} value={row.target === 'all' ? 'all' : row.target}
              onChange={(e) => retarget(row, e.target.value)}>
              <option value="all" disabled={row.target !== 'all' && freeGlobal() === undefined}>全体</option>
              {blocks.map((b, i) => <option key={i} value={i} disabled={i !== row.target && !!b.suit}>{blockLabel(i)}</option>)}
            </select>
            <div className="suit-value">
              {row.target === 'all'
                ? <select className="input suit-kind" aria-label={`${where}のスート条件`} value={globalKey(row.condition)}
                  onChange={(e) => replaceRow(row, { ...row, condition: makeGlobal(e.target.value) })}>
                  {GLOBAL_CHOICES.map(([id, label]) => <option key={id} value={id} disabled={id !== globalKey(row.condition) && usedSlots.has(slotOf(id)) && slotOf(id) !== slotOf(globalKey(row.condition))}>{label}</option>)}
                </select>
                : <select className="input suit-kind" aria-label={`${where}のスート条件`} value={choice!}
                  onChange={(e) => { const suit = suitFromChoice(e.target.value as SuitChoice, row.suit); if (suit) replaceRow(row, { ...row, suit }); }}>
                  {SUIT_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  {choice === 'other' && row.suit.kind === 'in' && <option value="other">{row.suit.suits.map((s) => SUIT_MARK[s]).join('')}</option>}
                </select>}
              {param && <Stepper hideLabel label={`${where}の${param.label}`} suffix={param.suffix} value={param.value} min={param.min} max={param.max}
                onChange={(count) => { if (row.target === 'all') replaceRow(row, { ...row, condition: { ...row.condition, count } as GlobalCondition }); }} />}
            </div>
            <button type="button" className="btn btn-ghost block-remove" aria-label={`${where}のスート条件を消す`} onClick={() => replaceRow(row, null)}>×</button>
          </li>;
        })}
      </ul>}
      <button type="button" className="btn btn-ghost" disabled={!canAdd} onClick={addRow}><Icon kind="plus" />スート条件を足す</button>
    </div>
  );
}

/** スート条件の1行。全体（global の at 番目）か、まとまり（target 番目）にかかる。 */
type SuitRow =
  | { readonly target: 'all'; readonly at: number; readonly condition: GlobalCondition }
  | { readonly target: number; readonly suit: BlockSuit };

/** 全体にかけるスート条件。色は赤＝♥♦、黒＝♠♣ なのでスートの一種として並べる。 */
const GLOBAL_CHOICES: readonly (readonly [string, string])[] = [
  ['allSameSuit', 'すべて同じスート'], ['allDifferentSuit', 'すべて違うスート'],
  ['suitCount', '同じスートがN枚以上'], ['suitKinds', 'スートがN種類以上'],
  ['allSameColor', 'すべて同じ色'], ['color:red', 'すべて赤'], ['color:black', 'すべて黒'],
  ['colorCount:red', '赤がN枚以上'], ['colorCount:black', '黒がN枚以上'],
];

const SUIT_GLOBALS: ReadonlySet<GlobalCondition['type']> = new Set(['allSameSuit', 'allDifferentSuit', 'suitCount', 'suitKinds', 'allSameColor', 'color', 'colorCount']);
const isSuitGlobal = (g: GlobalCondition) => SUIT_GLOBALS.has(g.type);

function globalKey(g: GlobalCondition): string {
  if (g.type === 'color' || g.type === 'colorCount') return `${g.type}:${g.color}`;
  return g.type;
}

/** 同時に置けない組。「すべて赤」と「すべて黒」は同じ枠を取り合う。 */
const slotOf = (key: string) => (key.startsWith('color:') ? 'color' : key);

function makeGlobal(key: string): GlobalCondition {
  const [type, color] = key.split(':') as [string, CardColor | undefined];
  switch (type) {
    case 'suitCount': return { type: 'suitCount', count: 3 };
    case 'suitKinds': return { type: 'suitKinds', count: 4 };
    case 'color': return { type: 'color', color: color! };
    case 'colorCount': return { type: 'colorCount', color: color!, count: 3 };
    default: return { type } as GlobalCondition;
  }
}

/** 枚数・種類を選ぶ条件なら、その数の範囲。 */
function countParam(g: GlobalCondition, handSize: number) {
  switch (g.type) {
    case 'suitCount': return { label: '同じスートの枚数', suffix: '枚', value: g.count, min: 2, max: handSize };
    case 'suitKinds': return { label: 'スートの種類', suffix: '種', value: g.count, min: 2, max: 4 };
    case 'colorCount': return { label: `${g.color === 'red' ? '赤' : '黒'}の枚数`, suffix: '枚', value: g.count, min: 1, max: handSize };
    default: return null;
  }
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
 *
 * 最後の1つは外せない。ランクが空のまとまりは役の形から消えてしまう。
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
    if (selected.includes(rank) && selected.length === 1) return;
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
    </div>
  );
}

/**
 * 種類を変えても、枚数・候補・スートはできるだけ引き継ぐ。
 *
 * ランクを選ぶ種類へ変えるとき、引き継ぐランクが無ければ強いほうから枚数ぶん選んでおく。
 * ランクが空のまとまりは0枚になり、役の形から消えてしまう（行ごと無くなる）。
 */
function convert(block: PatternBlock, kind: PatternBlock['kind'], deckRanks: readonly Rank[]): PatternBlock {
  const count = blockSize(block);
  const suit = block.suit ? { suit: block.suit } : {};
  const picked = block.kind === 'fixed' || block.kind === 'oneOf' ? block.ranks : [];
  const ranks = picked.length > 0 ? [...picked] : deckRanks.slice(-Math.max(1, count));
  switch (kind) {
    case 'sameRank':
      return { kind: 'sameRank', count, ...suit };
    case 'run':
      return { kind: 'run', count, ...suit };
    case 'any':
      return { kind: 'any', count, ...suit };
    case 'fixed':
      return { kind: 'fixed', ranks, ...suit };
    case 'oneOf':
      return { kind: 'oneOf', ranks, count, ...suit };
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
