import { COLOR_SUITS, SUITS, type CardCondition, type GlobalCondition, type HandPattern, type Rank, type Suit } from '../types.js';

/**
 * 役の条件を「まとまり」として扱う層。
 *
 * HandPattern はカード1枚ずつの条件が並んだ配列で、判定にはこの形がよい。
 * だが人が作るときは1枚ずつ考えない——「同じランクが3枚」「連続する5枚」
 * という**まとまり**で考える。フルハウスは `X X X Y Y` ではなく
 * 「3枚組と2枚組」である。
 *
 * ここはその相互変換だけを持つ。編集画面はまとまりを並べ替えるだけでよくなり、
 * 変数名（X, Y）の管理を画面側に持ち込まずに済む。
 *
 * **戻せない形は null を返す。** まとまりの中で札ごとにスートが違う役のように、
 * まとまりで表せない条件は作ってあるかもしれない。黙って近い形に
 * 直すと、編集しただけで役が変わってしまう。
 */

/**
 * まとまりのスート。
 * - same: このまとまりの札は同じスート（別の same のまとまりとは違うスート）
 * - in:   このスートのどれか（1つのスートや、色＝2つのスート）
 */
export type BlockSuit =
  | { readonly kind: 'same' }
  | { readonly kind: 'in'; readonly suits: readonly Suit[] };

interface BlockBase {
  /** 省略は「スートを問わない」。 */
  readonly suit?: BlockSuit;
}

export type PatternBlock =
  /** 同じランクが count 枚（ペア・スリーカード・フォーカード）。 */
  | (BlockBase & { readonly kind: 'sameRank'; readonly count: number })
  /**
   * 連続する count 枚（ストレート）。
   * - step: 間隔。2 なら1つ飛ばし（3 5 7 9 J）。省略は 1
   * - wrap: 端で回り込む（Q K A 2 3）
   * - continues: 直前の連続のまとまりから続ける（ストレートフラッシュハウスの「3枚＋2枚」）
   */
  | (BlockBase & { readonly kind: 'run'; readonly count: number; readonly step?: number; readonly wrap?: boolean; readonly continues?: boolean })
  /** 決まったランクを並べる（10 J Q K A）。 */
  | (BlockBase & { readonly kind: 'fixed'; readonly ranks: readonly Rank[] })
  /** 指定した候補から count 枚（素数ストレート）。 */
  | (BlockBase & { readonly kind: 'oneOf'; readonly ranks: readonly Rank[]; readonly count: number })
  /** 何でもよい count 枚。 */
  | (BlockBase & { readonly kind: 'any'; readonly count: number });

/** 変数名。足りなくなったら X1, X2 と続ける。 */
const NAMES = ['X', 'Y', 'Z', 'W', 'V', 'U'] as const;
const nameAt = (i: number): string => NAMES[i] ?? `X${i - NAMES.length + 1}`;
/** スートのまとまりの名前。 */
const suitGroupAt = (i: number): string => `S${i + 1}`;

export function fromBlocks(
  blocks: readonly PatternBlock[],
  global: readonly GlobalCondition[] = [],
): HandPattern {
  const cards: CardCondition[] = [];
  let variables = 0;
  let suitGroups = 0;
  /** 直前の連続のまとまり。continues で続けるときに使う。 */
  let lastRun: { name: string; next: number } | null = null;

  let previous: PatternBlock | undefined;
  for (const block of blocks) {
    const suitGroup = block.suit?.kind === 'same' ? suitGroupAt(suitGroups++) : undefined;
    const suits = block.suit?.kind === 'in' ? [...block.suit.suits] : [];
    // 前のまとまりと見分けがつかないときだけ、最初の札に区切りを置く。
    let split = previous !== undefined && blockSize(previous) > 0 && mergesWith(previous, block);
    previous = block;
    // 余計なキーは置かない。書き出した JSON を元のプリセットと一致させるため。
    const withSuit = (rank: CardCondition['rank']): CardCondition => {
      const cond: CardCondition = suitGroup === undefined ? { rank, suits } : { rank, suits, suitGroup };
      if (!split) return cond;
      split = false;
      return { ...cond, split: true };
    };

    switch (block.kind) {
      case 'sameRank': {
        const name = nameAt(variables++);
        for (let i = 0; i < block.count; i++) cards.push(withSuit({ type: 'variable', name }));
        lastRun = null;
        break;
      }
      case 'run': {
        const step = block.step ?? 1;
        const continuing: boolean = block.continues === true && lastRun !== null;
        const name: string = continuing ? lastRun!.name : nameAt(variables++);
        const start: number = continuing ? lastRun!.next : 0;
        for (let i = 0; i < block.count; i++) {
          const offset = start + i * step;
          // offset 0 はキー自体を置かない。判定は同じだが、
          // 書き出した JSON が元のプリセットと一致しなくなる。
          cards.push(withSuit({
            type: 'variable',
            name,
            ...(offset === 0 ? {} : { offset }),
            ...(block.wrap ? { wrap: true } : {}),
          }));
        }
        lastRun = { name, next: start + block.count * step };
        break;
      }
      case 'fixed':
        for (const value of block.ranks) cards.push(withSuit({ type: 'fixed', value }));
        lastRun = null;
        break;
      case 'oneOf':
        for (let i = 0; i < block.count; i++) cards.push(withSuit({ type: 'oneOf', values: [...block.ranks] }));
        lastRun = null;
        break;
      case 'any':
        for (let i = 0; i < block.count; i++) cards.push(withSuit({ type: 'any' }));
        lastRun = null;
        break;
    }
  }

  return { cards, global: [...global] };
}

/**
 * 区切りが無いと、開き直したときに前のまとまりと1つになってしまうか。
 * 変数を使う種類（同じランク・連続）は変数名で分かれるので要らない。
 * 「同じスート」はまとまりごとに別のスートなので、それでも分かれる。
 */
function mergesWith(previous: PatternBlock, block: PatternBlock): boolean {
  if (previous.kind !== block.kind || block.suit?.kind === 'same') return false;
  if (JSON.stringify(previous.suit ?? null) !== JSON.stringify(block.suit ?? null)) return false;
  if (block.kind === 'oneOf' && previous.kind === 'oneOf') return previous.ranks.join(',') === block.ranks.join(',');
  return block.kind === 'fixed' || block.kind === 'any';
}

/** 札の条件のスートの部分。同じまとまりに入れてよいかを比べる鍵。 */
const suitKey = (cond: CardCondition): string => `${cond.suits.join(',')}|${cond.suitGroup ?? ''}`;

function blockSuitOf(cond: CardCondition): BlockSuit | undefined | null {
  if (cond.suitGroup !== undefined) return cond.suits.length === 0 ? { kind: 'same' } : null;
  return cond.suits.length === 0 ? undefined : { kind: 'in', suits: [...cond.suits] };
}

export function toBlocks(pattern: HandPattern): PatternBlock[] | null {
  const conditions = pattern.cards;
  const blocks: PatternBlock[] = [];
  const seenNames = new Set<string>();
  const seenGroups = new Set<string>();
  /** 直前の連続のまとまり（続きを見分けるため）。 */
  let lastRun: { name: string; next: number; step: number; wrap: boolean } | null = null;
  let i = 0;

  while (i < conditions.length) {
    const first = conditions[i]!;
    const spec = first.rank;
    const key = suitKey(first);
    const suit = blockSuitOf(first);
    if (suit === null) return null;
    // 同じスートのまとまりは1か所にまとまっていなければならない。
    if (first.suitGroup !== undefined) {
      if (seenGroups.has(first.suitGroup)) return null;
      seenGroups.add(first.suitGroup);
    }
    const withSuit = <T extends PatternBlock>(block: T): T => (suit === undefined ? block : { ...block, suit });
    /** スートの指定が同じで、区切りが無いあいだだけ、同じまとまりに入れる。 */
    const blockStart = i;
    const sameSuit = (at: number) => suitKey(conditions[at]!) === key && (at === blockStart || conditions[at]!.split !== true);

    switch (spec.type) {
      case 'variable': {
        const offsets: number[] = [];
        const wrap = spec.wrap === true;
        while (i < conditions.length && sameSuit(i)) {
          const next = conditions[i]!.rank;
          if (next.type !== 'variable' || next.name !== spec.name || (next.wrap === true) !== wrap) break;
          offsets.push(next.offset ?? 0);
          i++;
        }

        const continuing: boolean = lastRun !== null && lastRun.name === spec.name && seenNames.has(spec.name);
        if (!continuing) {
          // 同じ変数名は1か所にまとまっていなければならない（続きを除く）。
          // 離れて現れる形は、まとまりとして言い表せない。
          if (seenNames.has(spec.name)) return null;
          seenNames.add(spec.name);
        }

        if (!continuing && offsets.every((offset) => offset === 0)) {
          if (wrap) return null;
          blocks.push(withSuit({ kind: 'sameRank', count: offsets.length }));
          lastRun = null;
          break;
        }

        // 等間隔に並んでいれば連続のまとまり。間隔は2枚目との差で決まる。
        const step: number = continuing ? lastRun!.step : offsets.length > 1 ? offsets[1]! - offsets[0]! : 1;
        const start: number = continuing ? lastRun!.next : 0;
        if (step < 1 || offsets.some((offset, at) => offset !== start + at * step)) return null;
        if (continuing && wrap !== lastRun!.wrap) return null;
        blocks.push(withSuit({
          kind: 'run',
          count: offsets.length,
          ...(step === 1 ? {} : { step }),
          ...(wrap ? { wrap: true } : {}),
          ...(continuing ? { continues: true } : {}),
        }));
        lastRun = { name: spec.name, next: start + offsets.length * step, step, wrap };
        break;
      }
      case 'fixed': {
        const ranks: Rank[] = [];
        while (i < conditions.length && sameSuit(i)) {
          const next = conditions[i]!.rank;
          if (next.type !== 'fixed') break;
          ranks.push(next.value);
          i++;
        }
        blocks.push(withSuit({ kind: 'fixed', ranks }));
        lastRun = null;
        break;
      }
      case 'oneOf': {
        const values = spec.values.join(',');
        let count = 0;
        while (i < conditions.length && sameSuit(i)) {
          const next = conditions[i]!.rank;
          if (next.type !== 'oneOf' || next.values.join(',') !== values) break;
          count++;
          i++;
        }
        blocks.push(withSuit({ kind: 'oneOf', ranks: [...spec.values], count }));
        lastRun = null;
        break;
      }
      case 'any': {
        let count = 0;
        while (i < conditions.length && sameSuit(i) && conditions[i]!.rank.type === 'any') {
          count++;
          i++;
        }
        blocks.push(withSuit({ kind: 'any', count }));
        lastRun = null;
        break;
      }
    }
  }

  return blocks;
}

const SUIT_MARK: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/** まとまりのスートを日本語にする（「、同じスート」「（赤）」など）。 */
export function describeBlockSuit(suit: BlockSuit | undefined): string {
  if (!suit) return '';
  if (suit.kind === 'same') return '、同じスート';
  const sorted = SUITS.filter((s) => suit.suits.includes(s));
  if (sorted.length === 2 && COLOR_SUITS.red.every((s) => sorted.includes(s))) return '、赤';
  if (sorted.length === 2 && COLOR_SUITS.black.every((s) => sorted.includes(s))) return '、黒';
  return `、${sorted.map((s) => SUIT_MARK[s]).join('')}`;
}

/** まとまり1つを日本語にする。 */
export function describeBlock(block: PatternBlock): string {
  const suit = describeBlockSuit(block.suit);
  switch (block.kind) {
    case 'sameRank':
      return `同じランクが${block.count}枚${suit}`;
    case 'run': {
      const step = block.step ?? 1;
      const kind = step === 1 ? '連続する' : step === 2 ? '1つ飛ばしで連続する' : `${step - 1}つ飛ばしで連続する`;
      return `${block.continues ? '続けて' : ''}${kind}${block.count}枚${block.wrap ? '（回り込みあり）' : ''}${suit}`;
    }
    case 'fixed':
      return `${block.ranks.join(' ')} の${block.ranks.length}枚${suit}`;
    case 'oneOf':
      return `${block.ranks.join('・')} から${block.count}枚${suit}`;
    case 'any':
      return `任意の${block.count}枚${suit}`;
  }
}

/** まとまりが使うカードの枚数。役の枚数を超えていないかを見るのに使う。 */
export const blockSize = (block: PatternBlock): number =>
  block.kind === 'fixed' ? block.ranks.length : block.count;
