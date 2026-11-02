import type { Card, Rank, Suit } from '../src/types.js';
import { RANKS, SUITS } from '../src/types.js';
import { compareHands, type HandResult } from '../src/rules/evaluate.js';

/**
 * 役判定の「答え合わせ用」の素朴な実装。
 *
 * エンジンの役判定（パターン・変数・ブロック）は一切使わず、教科書どおりの
 * 数え方だけで書く。速さより読みやすさを優先する。エンジンと同じ間違いを
 * しないよう、エンジンのコードは参照しない（デッキの型だけ借りる）。
 */

export interface RefRules {
  /** 弱い順のランク（deck.ranks）。 */
  readonly strength: readonly Rank[];
  /** 連続の物差し（deck.sequence）。既定は 2…A。 */
  readonly sequence?: readonly Rank[];
  /** 最弱のストレートとして扱う並び（ホイール A-2-3-4-5 など）。 */
  readonly lowStraight?: readonly Rank[];
  /** フラッシュをフルハウスより強くする。 */
  readonly flushOverBoat?: boolean;
  /** ファイブカード（同じランク5枚）がある。 */
  readonly fiveOfAKind?: boolean;
  /** フラッシュハウス（同じスートのフルハウス）がある。 */
  readonly flushHouse?: boolean;
}

export const STANDARD_REF: RefRules = { strength: RANKS, lowStraight: ['A', '2', '3', '4', '5'] };

// 役の段階。大きいほど強い。
const HIGH = 0, PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4, FLUSH = 5, FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8, FIVE = 9, FLUSH_HOUSE = 10;

/** 段階の名前（失敗したときに読めるように）。 */
export const REF_CATEGORY_NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ', 'ファイブカード', 'フラッシュハウス'];

/**
 * ちょうど5枚の強さを数の並びで返す。辞書順で大きいほうが強い。
 * 先頭は役の段階（フラッシュとフルハウスの入れ替えは反映済み）。
 */
export function refKey(cards: readonly Card[], rules: RefRules): number[] {
  if (cards.length !== 5) throw new Error('5枚で呼ぶこと');
  const strength = (rank: Rank) => {
    const i = rules.strength.indexOf(rank);
    if (i < 0) throw new Error(`デッキに無いランク ${rank}`);
    return i;
  };
  const values = cards.map((c) => strength(c.rank)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);

  // ランクごとの枚数。枚数の多い順、同じなら強い順。
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.flatMap(([v, n]) => Array<number>(n).fill(v));
  const shape = groups.map(([, n]) => n).join('');

  // ストレート。0 は最弱の特例（ホイール）、それ以外は連続の一番上の位置 + 1。
  let straightTop = -1;
  if (shape === '11111') {
    const ranks = cards.map((c) => c.rank);
    const low = rules.lowStraight;
    if (low && low.every((r) => ranks.includes(r))) {
      straightTop = 0;
    } else {
      const sequence = rules.sequence ?? RANKS;
      const steps = ranks.map((r) => sequence.indexOf(r)).sort((a, b) => a - b);
      if (steps[0]! >= 0 && steps[4]! - steps[0]! === 4) straightTop = steps[4]! + 1;
    }
  }

  const flushCat = rules.flushOverBoat ? FULL_HOUSE : FLUSH;
  const boatCat = rules.flushOverBoat ? FLUSH : FULL_HOUSE;

  if (rules.flushHouse && flush && shape === '32') return [FLUSH_HOUSE, ...byGroup];
  if (rules.fiveOfAKind && shape === '5') return [FIVE, values[0]!];
  if (straightTop >= 0 && flush) return [STRAIGHT_FLUSH, straightTop];
  if (shape === '41' || shape === '5') return [QUADS, ...byGroup];
  // フラッシュがフルハウスより強いなら、先に見る。
  if (rules.flushOverBoat && flush) return [flushCat, ...values];
  if (shape === '32') return [boatCat, ...byGroup];
  if (flush) return [flushCat, ...values];
  if (straightTop >= 0) return [STRAIGHT, straightTop];
  if (shape === '311') return [TRIPS, ...byGroup];
  if (shape === '221') return [TWO_PAIR, ...byGroup];
  if (shape === '2111') return [PAIR, ...byGroup];
  return [HIGH, ...values];
}

export function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * ワイルド入りの5枚の強さ。ワイルドを、デッキにありうるすべての札で置き換えて最大を取る。
 *
 * 同じ札が手の中に重なってもよい（エンジンもジョーカーが手の中の札と同じ札になるのを許す）。
 * スートは「全員が実札のスートに揃える（フラッシュ狙い）」か「揃えない」かだけで結果が決まるので、
 * その2通りに絞る。ランクはワイルドどうし交換できるので重複組合せで数える。
 */
export function refWildKey(
  cards: readonly Card[],
  isWild: (card: Card) => boolean,
  rules: RefRules,
): number[] {
  const real = cards.filter((c) => !isWild(c));
  const wilds = cards.length - real.length;
  if (wilds === 0) return refKey(cards, rules);

  const realSuits = [...new Set(real.map((c) => c.suit))];
  const suitPlans: Suit[][] = [];
  // フラッシュを狙う置き換え（実札が1スートだけなら、そのスートに揃える）。
  if (realSuits.length <= 1) {
    const target = realSuits[0] ?? SUITS[0]!;
    suitPlans.push(Array<Suit>(wilds).fill(target));
  }
  // 揃えない置き換え。実札と違うスートを1枚目に置けばフラッシュにならない。
  const other = SUITS.find((s) => !realSuits.includes(s)) ?? SUITS.find((s) => s !== realSuits[0]) ?? SUITS[0]!;
  suitPlans.push(Array<Suit>(wilds).fill(realSuits[0] ?? SUITS[1]!).map((s, i) => (i === 0 ? other : s)));

  let best: number[] | null = null;
  const ranks = rules.strength;
  const pick: Rank[] = [];
  const walk = (start: number): void => {
    if (pick.length === wilds) {
      for (const suits of suitPlans) {
        const substituted = [...real, ...pick.map((rank, i) => ({ rank, suit: suits[i]! }))];
        const key = refKey(substituted, rules);
        if (best === null || compareKeys(key, best) > 0) best = key;
      }
      return;
    }
    for (let i = start; i < ranks.length; i++) {
      pick.push(ranks[i]!);
      walk(i);
      pick.pop();
    }
  };
  walk(0);
  return best!;
}

/**
 * エンジンの結果と答えの対応を集めて、並び順がまったく同じかを確かめる。
 *
 * 1. 答えが同じ強さの手は、エンジンでも引き分け（compareHands が 0）
 * 2. 答えで強い手は、エンジンでも強い
 *
 * この2つが成り立てば、エンジンの強さは答えと「並べ方として同一」になる。
 * 個々の数値（tiebreak の中身）が違っても構わない。
 */
export class OrderCheck {
  private readonly classes = new Map<string, { readonly ref: readonly number[]; readonly engine: HandResult; readonly label: string }>();

  add(ref: readonly number[], engine: HandResult, label: string): void {
    const id = ref.join(',');
    const seen = this.classes.get(id);
    if (seen === undefined) {
      this.classes.set(id, { ref, engine, label });
      return;
    }
    if (compareHands(seen.engine, engine) !== 0) {
      throw new Error(
        `答えでは同じ強さなのに、エンジンでは差がついた\n  ${seen.label} → ${describe(seen.engine)}\n  ${label} → ${describe(engine)}`,
      );
    }
  }

  get size(): number {
    return this.classes.size;
  }

  /** 答えの順に並べ、エンジンでも隣どうしが厳密に強くなっているか。 */
  verify(): void {
    const sorted = [...this.classes.values()].sort((a, b) => compareKeys(a.ref, b.ref));
    for (let i = 1; i < sorted.length; i++) {
      const weaker = sorted[i - 1]!, stronger = sorted[i]!;
      if (compareHands(stronger.engine, weaker.engine) <= 0) {
        throw new Error(
          `答えでは強いのに、エンジンでは強くない\n  強いはず: ${stronger.label} → ${describe(stronger.engine)}\n  弱いはず: ${weaker.label} → ${describe(weaker.engine)}`,
        );
      }
    }
  }
}

export const describe = (result: HandResult): string =>
  `${result.rankingName} [${result.tiebreak.join(',')}]`;

export const cardText = (cards: readonly Card[]): string =>
  cards.map((c) => (c.joker !== undefined ? `JK${c.joker}` : `${c.rank}${c.suit[0]}`)).join(' ');

/** 山から重複なしに n 枚引く（同じ札が複数あるデッキでは、同じ札が重なりうる）。 */
export function draw(deck: readonly Card[], n: number, rng: () => number): Card[] {
  const pool = [...deck];
  const out: Card[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    out.push(pool[i]!);
  }
  return out;
}

/** items から k 個選ぶ組み合わせ（エンジンの combinations とは別に書く）。 */
export function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items;
  return [...subsets(rest, k - 1).map((s) => [head!, ...s]), ...subsets(rest, k)];
}
