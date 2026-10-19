import type { Card, CardCondition, DeckRules, GlobalCondition, HandPattern, Suit } from '../types.js';
import { rankValue, suitValue } from '../deck.js';

export interface PatternMatch {
  /** 役を構成するカード。 */
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
 *
 * 探索はカードを1枚割り当てるたびに条件を検証して枝刈りする。
 * 総当たりだと `any` が5つ並ぶパターン（フラッシュ）で1組合せ120通りを
 * 無駄に展開してしまい、モンテカルロを回すCPU相手には実用速度に届かなかった。
 */
export function matchPattern(
  hand: readonly Card[],
  pattern: HandPattern,
  deck: DeckRules,
): PatternMatch | null {
  const conditions = pattern.cards;
  const k = conditions.length;
  if (k > hand.length) return null;

  const order = conditionOrder(conditions);
  // 同一スート条件は割り当てるたびに判定できるので、枝刈りに使う。
  const requireSameSuit = pattern.global.some((g) => g.type === 'allSameSuit');

  /** pattern.cards の index -> hand の index */
  const assigned = new Array<number>(k).fill(-1);
  const used = new Array<boolean>(hand.length).fill(false);
  /** 変数名 -> 基準ランクの index */
  const bindings = new Map<string, number>();
  let suitLock: Suit | null = null;
  let best: PatternMatch | null = null;

  const search = (step: number, minFreeCard: number): void => {
    if (step === k) {
      const candidate = finish(hand, conditions, assigned, pattern.global, deck);
      if (candidate && (best === null || compareTiebreak(candidate.tiebreak, best.tiebreak) > 0)) {
        best = candidate;
      }
      return;
    }

    const ci = order[step]!;
    const cond = conditions[ci]!;
    // 制約のない条件は互いに交換可能なので、カード添字を増加方向に限って
    // 同じ組合せを何度も試さないようにする（順列ではなく組合せの列挙になる）。
    const free = isFree(cond);
    const start = free ? minFreeCard : 0;

    for (let h = start; h < hand.length; h++) {
      if (used[h]) continue;
      const card = hand[h]!;

      if (cond.suits.length > 0 && !cond.suits.includes(card.suit)) continue;

      const lockedHere = requireSameSuit && suitLock === null;
      if (requireSameSuit && suitLock !== null && card.suit !== suitLock) continue;

      const bound = bindRank(cond, card, deck, bindings);
      if (bound === null) continue;

      if (lockedHere) suitLock = card.suit;
      used[h] = true;
      assigned[ci] = h;

      search(step + 1, free ? h + 1 : 0);

      assigned[ci] = -1;
      used[h] = false;
      if (lockedHere) suitLock = null;
      if (bound.added) bindings.delete(bound.added);
    }
  };

  search(0, 0);
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

/** ランクもスートも問わない条件か。こうした条件は互いに交換可能になる。 */
function isFree(cond: CardCondition): boolean {
  return cond.rank.type === 'any' && cond.suits.length === 0;
}

/**
 * 条件を試す順番を決める。制約の強いものを先に置くほど枝刈りが効く。
 *
 * 1. 固定ランク — 候補が即座に数枚に絞られる
 * 2. 変数ランク — 同名をまとめ、枚数の多い変数から。2枚目以降は束縛済みで強く絞れる
 * 3. 無制約 — 絞り込めないので最後
 */
function conditionOrder(conditions: readonly CardCondition[]): number[] {
  const fixed: number[] = [];
  const free: number[] = [];
  const byVariable = new Map<string, number[]>();

  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i]!;
    if (cond.rank.type === 'fixed') {
      fixed.push(i);
    } else if (cond.rank.type === 'variable') {
      const bucket = byVariable.get(cond.rank.name);
      if (bucket) bucket.push(i);
      else byVariable.set(cond.rank.name, [i]);
    } else if (cond.suits.length > 0) {
      // スート指定があるなら無制約ではない。固定ランクの次に絞り込める。
      fixed.push(i);
    } else {
      free.push(i);
    }
  }

  const variables = [...byVariable.values()].sort((a, b) => b.length - a.length).flat();
  return [...fixed, ...variables, ...free];
}

interface Binding {
  /** 今回新たに追加した変数名。backtrack 時に消す。追加していなければ null。 */
  readonly added: string | null;
}

/**
 * ランク条件を検証する。不成立なら null。
 * 変数条件なら bindings に基準ランクを記録する（既存の束縛や他変数と矛盾すれば null）。
 */
function bindRank(
  cond: CardCondition,
  card: Card,
  deck: DeckRules,
  bindings: Map<string, number>,
): Binding | null {
  const spec = cond.rank;

  switch (spec.type) {
    case 'any':
      return { added: null };

    case 'fixed':
      return card.rank === spec.value ? { added: null } : null;

    case 'variable': {
      const base = rankValue(card.rank, deck) - (spec.offset ?? 0);
      if (base < 0 || base >= deck.ranks.length) return null;

      const existing = bindings.get(spec.name);
      if (existing !== undefined) return existing === base ? { added: null } : null;

      // 異なる変数名は異なるランクを指す。
      for (const other of bindings.values()) {
        if (other === base) return null;
      }
      bindings.set(spec.name, base);
      return { added: spec.name };
    }
  }
}

/** 割り当てが完成した時点で、残りの全体条件を検証して PatternMatch を組む。 */
function finish(
  hand: readonly Card[],
  conditions: readonly CardCondition[],
  assigned: readonly number[],
  globals: readonly GlobalCondition[],
  deck: DeckRules,
): PatternMatch | null {
  const matched = assigned.map((h) => hand[h]!);

  for (const global of globals) {
    // allSameSuit は探索中に枝刈り済みだが、安全のため最終確認する。
    if (!satisfiesGlobal(matched, global, deck)) return null;
  }

  const used = new Set(assigned);
  const kickers = hand.filter((_, i) => !used.has(i));

  return { matched, kickers, tiebreak: buildTiebreak(matched, conditions, kickers, deck) };
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
  conditions: readonly CardCondition[],
  kickers: readonly Card[],
  deck: DeckRules,
): number[] {
  const groups = new Map<string, Card[]>();
  for (let i = 0; i < matched.length; i++) {
    const key = groupKey(conditions[i]!, i);
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

/** 同一グループ＝同じ変数、または同じ固定ランク。無制約の条件は常に単独グループ。 */
function groupKey(cond: CardCondition, index: number): string {
  switch (cond.rank.type) {
    case 'variable':
      return `var:${cond.rank.name}`;
    case 'fixed':
      return `fixed:${cond.rank.value}`;
    case 'any':
      return `any:${index}`;
  }
}
