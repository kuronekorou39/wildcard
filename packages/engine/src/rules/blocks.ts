import type { CardCondition, GlobalCondition, HandPattern, Rank } from '../types.js';

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
 * **戻せない形は null を返す。** 1枚ずつスートを指定した役のように、
 * まとまりで表せない条件は作ってあるかもしれない。黙って近い形に
 * 直すと、編集しただけで役が変わってしまう。
 */

export type PatternBlock =
  /** 同じランクが count 枚（ペア・スリーカード・フォーカード）。 */
  | { readonly kind: 'sameRank'; readonly count: number }
  /** 連続する count 枚（ストレート）。 */
  | { readonly kind: 'run'; readonly count: number }
  /** 決まったランクを並べる（10 J Q K A）。 */
  | { readonly kind: 'fixed'; readonly ranks: readonly Rank[] }
  /** 指定した候補から count 枚（素数ストレート）。 */
  | { readonly kind: 'oneOf'; readonly ranks: readonly Rank[]; readonly count: number }
  /** 何でもよい count 枚。 */
  | { readonly kind: 'any'; readonly count: number };

/** 変数名。足りなくなったら X1, X2 と続ける。 */
const NAMES = ['X', 'Y', 'Z', 'W', 'V', 'U'] as const;
const nameAt = (i: number): string => NAMES[i] ?? `X${i - NAMES.length + 1}`;

export function fromBlocks(
  blocks: readonly PatternBlock[],
  global: readonly GlobalCondition[] = [],
): HandPattern {
  const cards: CardCondition[] = [];
  let variables = 0;

  for (const block of blocks) {
    switch (block.kind) {
      case 'sameRank': {
        const name = nameAt(variables++);
        for (let i = 0; i < block.count; i++) {
          cards.push({ rank: { type: 'variable', name }, suits: [] });
        }
        break;
      }
      case 'run': {
        const name = nameAt(variables++);
        for (let i = 0; i < block.count; i++) {
          // offset 0 はキー自体を置かない。判定は同じだが、
          // 書き出した JSON が元のプリセットと一致しなくなる。
          cards.push({
            rank: i === 0 ? { type: 'variable', name } : { type: 'variable', name, offset: i },
            suits: [],
          });
        }
        break;
      }
      case 'fixed':
        for (const value of block.ranks) {
          cards.push({ rank: { type: 'fixed', value }, suits: [] });
        }
        break;
      case 'oneOf':
        for (let i = 0; i < block.count; i++) {
          cards.push({ rank: { type: 'oneOf', values: [...block.ranks] }, suits: [] });
        }
        break;
      case 'any':
        for (let i = 0; i < block.count; i++) {
          cards.push({ rank: { type: 'any' }, suits: [] });
        }
        break;
    }
  }

  return { cards, global: [...global] };
}

export function toBlocks(pattern: HandPattern): PatternBlock[] | null {
  const conditions = pattern.cards;

  // 1枚ずつスートを指定した役は、まとまりでは表せない。
  if (conditions.some((cond) => cond.suits.length > 0)) return null;

  const blocks: PatternBlock[] = [];
  const seenNames = new Set<string>();
  let i = 0;

  while (i < conditions.length) {
    const spec = conditions[i]!.rank;

    switch (spec.type) {
      case 'variable': {
        // 同じ変数名は1か所にまとまっていなければならない。
        // 離れて現れる形は、まとまりとして言い表せない。
        if (seenNames.has(spec.name)) return null;
        seenNames.add(spec.name);

        const offsets: number[] = [];
        while (i < conditions.length) {
          const next = conditions[i]!.rank;
          if (next.type !== 'variable' || next.name !== spec.name) break;
          offsets.push(next.offset ?? 0);
          i++;
        }

        if (offsets.every((offset) => offset === 0)) {
          blocks.push({ kind: 'sameRank', count: offsets.length });
        } else if (offsets.every((offset, at) => offset === at)) {
          blocks.push({ kind: 'run', count: offsets.length });
        } else {
          // X, X+2 のような飛び石。作れはするが、言葉にできない。
          return null;
        }
        break;
      }
      case 'fixed': {
        const ranks: Rank[] = [];
        while (i < conditions.length) {
          const next = conditions[i]!.rank;
          if (next.type !== 'fixed') break;
          ranks.push(next.value);
          i++;
        }
        blocks.push({ kind: 'fixed', ranks });
        break;
      }
      case 'oneOf': {
        const key = spec.values.join(',');
        let count = 0;
        while (i < conditions.length) {
          const next = conditions[i]!.rank;
          if (next.type !== 'oneOf' || next.values.join(',') !== key) break;
          count++;
          i++;
        }
        blocks.push({ kind: 'oneOf', ranks: [...spec.values], count });
        break;
      }
      case 'any': {
        let count = 0;
        while (i < conditions.length && conditions[i]!.rank.type === 'any') {
          count++;
          i++;
        }
        blocks.push({ kind: 'any', count });
        break;
      }
    }
  }

  return blocks;
}

/** まとまり1つを日本語にする。 */
export function describeBlock(block: PatternBlock): string {
  switch (block.kind) {
    case 'sameRank':
      return `同じランクが${block.count}枚`;
    case 'run':
      return `連続する${block.count}枚`;
    case 'fixed':
      return `${block.ranks.join(' ')} の${block.ranks.length}枚`;
    case 'oneOf':
      return `${block.ranks.join('・')} から${block.count}枚`;
    case 'any':
      return `任意の${block.count}枚`;
  }
}

/** まとまりが使うカードの枚数。役の枚数を超えていないかを見るのに使う。 */
export const blockSize = (block: PatternBlock): number =>
  block.kind === 'fixed' ? block.ranks.length : block.count;
