import type { Card, DeckRules, GlobalCondition, HandPattern, RankSpec } from '../types.js';
import { rankValue, suitValue } from '../deck.js';

export interface PatternMatch {
  /** 役を構成するカード（pattern.cards と同じ順序）。 */
  readonly matched: readonly Card[];
  /** 役に使われなかった残りのカード（キッカー）。 */
  readonly kickers: readonly Card[];
  /** 同じ役同士の比較キー。要素ごとに比較し、大きいほうが強い。 */
  readonly tiebreak: readonly number[];
}

/**
 * 5枚の手札が HandPattern を満たすかを判定する。
 *
 * 満たす割り当てが複数あるときは **最も強い割り当て** を返す。
 * 例) [A,A,K,K,2] に [X,X]（ワンペア）を当てると AA と KK の両方が成立するが、
 *     返るのは AA。先に見つかった方ではない。
 *
 * 変数の扱い:
 * - 同名の変数は同じランクを指す（X, X = ペア）
 * - offset は相対指定（X, X+1, X+2 = 連続する3枚）
 * - **異なる名前の変数は異なるランクを指す**（X, X, Y, Y = ツーペア。XとYが同ランクなら不成立）
 */
export function matchPattern(
  hand: readonly Card[],
  pattern: HandPattern,
  deck: DeckRules,
): PatternMatch | null {
  const k = pattern.cards.length;
  if (k > hand.length) return null;

  let best: PatternMatch | null = null;
  for (const selection of orderedSelections(hand.length, k)) {
    const candidate = tryAssignment(hand, selection, pattern, deck);
    if (candidate && (best === null || compareTiebreak(candidate.tiebreak, best.tiebreak) > 0)) {
      best = candidate;
    }
  }
  return best;
}

/** 比較キーを要素ごとに比較する。正なら a のほうが強い。 */
export function compareTiebreak(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** hand の selection[i] 番目のカードを pattern.cards[i] に割り当てて検証する。 */
function tryAssignment(
  hand: readonly Card[],
  selection: readonly number[],
  pattern: HandPattern,
  deck: DeckRules,
): PatternMatch | null {
  const matched: Card[] = [];
  /** 変数名 -> 基準ランクの index */
  const bindings = new Map<string, number>();
  /** 各カードが属するグループ名。同グループ＝同一の変数または同一の固定ランク。 */
  const groupOf: string[] = [];

  for (let i = 0; i < selection.length; i++) {
    const card = hand[selection[i]!]!;
    const cond = pattern.cards[i]!;

    // スート条件。空配列は「任意のスート」。
    if (cond.suits.length > 0 && !cond.suits.includes(card.suit)) return null;

    const group = bindRank(cond.rank, card, deck, bindings);
    if (group === null) return null;

    matched.push(card);
    groupOf.push(group);
  }

  // 異なる変数名は異なるランクを指す必要がある。
  const boundRanks = [...bindings.values()];
  if (new Set(boundRanks).size !== boundRanks.length) return null;

  for (const global of pattern.global) {
    if (!satisfiesGlobal(matched, global, deck)) return null;
  }

  const used = new Set(selection);
  const kickers = hand.filter((_, i) => !used.has(i));

  return {
    matched,
    kickers,
    tiebreak: buildTiebreak(matched, groupOf, kickers, deck),
  };
}

/**
 * ランク条件を検証し、そのカードが属するグループ名を返す。不成立なら null。
 * 変数条件の場合は bindings に基準ランクを記録する（既存の束縛と矛盾すれば null）。
 */
function bindRank(
  spec: RankSpec,
  card: Card,
  deck: DeckRules,
  bindings: Map<string, number>,
): string | null {
  const value = rankValue(card.rank, deck);

  switch (spec.type) {
    case 'fixed':
      return card.rank === spec.value ? `fixed:${spec.value}` : null;

    case 'any':
      // 'any' は毎回独立したグループ（＝サイズ1）として扱う。
      return `any:${bindings.size}:${value}:${card.suit}`;

    case 'variable': {
      const base = value - (spec.offset ?? 0);
      if (base < 0 || base >= deck.ranks.length) return null;
      const existing = bindings.get(spec.name);
      if (existing !== undefined && existing !== base) return null;
      bindings.set(spec.name, base);
      return `var:${spec.name}`;
    }
  }
}

function satisfiesGlobal(cards: readonly Card[], global: GlobalCondition, deck: DeckRules): boolean {
  switch (global.type) {
    case 'allSameSuit':
      return cards.every((c) => c.suit === cards[0]!.suit);

    case 'allDifferentSuit':
      return new Set(cards.map((c) => c.suit)).size === cards.length;

    case 'suitCount': {
      const counts = new Map<string, number>();
      for (const c of cards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
      return [...counts.values()].some((n) => n >= global.count);
    }

    case 'consecutive': {
      const values = cards.map((c) => rankValue(c.rank, deck)).sort((a, b) => a - b);
      return values.every((v, i) => i === 0 || v === values[i - 1]! + 1);
    }
  }
}

/**
 * 比較キーを作る。
 *
 * 同じランクのまとまり（グループ）を **枚数の多い順 → ランクの強い順** に並べ、
 * 続いてキッカーをランクの強い順に並べる。
 *
 * この順序規則だけでフルハウスの「スリーカードのランクが優先」が自然に出る
 * ——[K,K,K,A,A] はペアのほうが強ランクだが、枚数3のグループが先に来るため。
 */
function buildTiebreak(
  matched: readonly Card[],
  groupOf: readonly string[],
  kickers: readonly Card[],
  deck: DeckRules,
): number[] {
  const groups = new Map<string, Card[]>();
  for (let i = 0; i < matched.length; i++) {
    const key = groupOf[i]!;
    const bucket = groups.get(key);
    if (bucket) bucket.push(matched[i]!);
    else groups.set(key, [matched[i]!]);
  }

  // グループ内はランクの強い順に揃える。これでストレートの比較が
  // 「一番高い札から順に見る」という素直な形になる。
  const byRankDesc = (a: Card, b: Card) => rankValue(b.rank, deck) - rankValue(a.rank, deck);
  for (const bucket of groups.values()) bucket.sort(byRankDesc);

  const ordered = [...groups.values()].sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    return rankValue(b[0]!.rank, deck) - rankValue(a[0]!.rank, deck);
  });

  const sequence: Card[] = [...ordered.flat(), ...[...kickers].sort(byRankDesc)];

  const ranks = sequence.map((c) => rankValue(c.rank, deck));
  // スートに強弱を付けるルールのときのみ、最後の決め手としてスートを見る。
  if (!deck.suitRanking) return ranks;
  return [...ranks, ...sequence.map((c) => suitValue(c.suit, deck))];
}

/** 0..n-1 から k 個を選ぶ順列を列挙する。 */
function* orderedSelections(n: number, k: number): Generator<number[]> {
  const picked: number[] = [];
  const used = new Array<boolean>(n).fill(false);

  function* rec(): Generator<number[]> {
    if (picked.length === k) {
      yield picked.slice();
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      picked.push(i);
      yield* rec();
      picked.pop();
      used[i] = false;
    }
  }

  yield* rec();
}
