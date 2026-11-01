import type { Card, HandPattern, Rank, Suit, Variant, WildRule } from '../types.js';

/**
 * ワイルドカードの扱い。
 *
 * ジョーカーも「2がワイルド」も「片目のジャック」も同じ仕組みで表す。
 * 役を判定する前に、ワイルドを具体的なカードへ置き換えた候補を作り、
 * その中で一番強くなるものを採る。
 *
 * ## なぜ役ごとに候補を絞るのか
 *
 * 最初はデッキの全種類（標準なら52通り）で総当たりしていたが、実測すると
 * 1枚で 25ms、2枚で 472ms、3枚で **5.3秒** かかって使い物にならなかった。
 * C(7,5)=21 通りの組み合わせそれぞれで置き換えを展開するため。
 *
 * **役のパターンを見れば、その役に要る候補はごく少ない。**
 *
 * - スートの条件が無い役（フォーカード、ストレート等）では、スートは結果に
 *   影響しない。1つに固定してよい（スートに強弱があるなら最強のものを選ぶ）
 * - 同一スート条件の役（フラッシュ等）では、**ワイルドは全員同じスートになる**。
 *   1枚ずつ independently に選ばせる必要がない
 * - ランクは固定指定なら1つ、oneOf ならその一覧だけ
 *
 * これで3枚ワイルドでも実用速度に収まる。正しさは、素朴な総当たりと結果が
 * 一致することを differential テストで確かめている（wild.test.ts）。
 */

/**
 * 置き換えの組み合わせ数の上限。
 *
 * 絞り込み後は、3枚ワイルドでも1役あたり 455〜1,820 通りに収まる。
 * ここに当たるのは5枚全部がワイルドといった極端な場合だけで、
 * そのときは候補を打ち切るので結果がわずかに劣ることがある。
 * 起きる確率が無視できるほど小さいので、速度を優先した。
 */
const MAX_SUBSTITUTIONS = 20000;

/** そのカードがワイルドか。 */
export function isWild(card: Card, variant: Variant): boolean {
  return matchingRule(card, variant) !== undefined;
}

/** そのバリアントがワイルドを使うか。使わないなら置き換えの処理ごと飛ばせる。 */
export function hasWilds(variant: Variant): boolean {
  return (variant.ranking.wilds ?? []).length > 0 || (variant.deck.jokers ?? 0) > 0;
}

/**
 * ジョーカーの既定の扱い。ワイルドの設定にジョーカーの規則が無くても、
 * ジョーカーは何にでも化けるワイルドとして扱う。
 *
 * 規則が無いと、ジョーカーは表示用の仮の札（A♠）として判定されてしまっていた。
 * ジョーカーをデッキに入れただけで A♠ が増えたのと同じになり、意図と違う。
 */
const JOKER_ANYTHING: WildRule = { cards: { kind: 'joker' } };

/** 手札の中でワイルドが入っている位置。 */
export function wildPositions(cards: readonly Card[], variant: Variant): number[] {
  if (!hasWilds(variant)) return [];
  const out: number[] = [];
  for (const [i, card] of cards.entries()) {
    if (isWild(card, variant)) out.push(i);
  }
  return out;
}

function matchingRule(card: Card, variant: Variant): WildRule | undefined {
  const rules = variant.ranking.wilds ?? [];
  if (card.joker !== undefined && (variant.deck.jokers ?? 0) > 0 && !rules.some((rule) => rule.cards.kind === 'joker')) return JOKER_ANYTHING;
  for (const rule of rules) {
    const selector = rule.cards;
    if (selector.kind === 'joker') {
      if (card.joker !== undefined) return rule;
    } else if (selector.kind === 'rank') {
      if (card.joker === undefined && selector.ranks.includes(card.rank)) return rule;
    } else if (
      card.joker === undefined &&
      selector.cards.some((c) => c.rank === card.rank && c.suit === card.suit)
    ) {
      return rule;
    }
  }
  return undefined;
}

/** そのワイルドが化けられるランクとスート。 */
function allowedBy(card: Card, variant: Variant): { ranks: readonly Rank[]; suits: readonly Suit[] } {
  const rule = matchingRule(card, variant);
  return {
    ranks: rule?.becomes?.ranks ?? variant.deck.ranks,
    suits: rule?.becomes?.suits ?? variant.deck.suits,
  };
}

/** その役を作るのに要るランクの候補。固定や oneOf なら一気に減る。 */
function rankCandidates(pattern: HandPattern, allRanks: readonly Rank[]): Rank[] {
  const out = new Set<Rank>();
  for (const cond of pattern.cards) {
    switch (cond.rank.type) {
      case 'fixed':
        out.add(cond.rank.value);
        break;
      case 'oneOf':
        for (const rank of cond.rank.values) out.add(rank);
        break;
      default:
        // variable と any は、どのランクにもなりうる。
        for (const rank of allRanks) out.add(rank);
        return [...out];
    }
  }
  return [...out];
}

/**
 * その役がスートを見るか。見ないならスートは1つに固定してよい。
 *
 * 画面でも効く。フォーカードで「JOKER→8♠」と出すと、手の中に本物の
 * 8♠ が居るときに嘘を言っているように見える。スートに意味が無い役では
 * ランクだけ書けばよい。
 */
export function patternUsesSuits(pattern: HandPattern): boolean {
  if (pattern.cards.some((cond) => cond.suits.length > 0 || cond.suitGroup !== undefined)) return true;
  return pattern.global.some(
    (g) =>
      g.type === 'allSameSuit' || g.type === 'allDifferentSuit' || g.type === 'suitCount' ||
      g.type === 'allSameColor' || g.type === 'color' || g.type === 'colorCount' || g.type === 'suitKinds',
  );
}

/** スートに強弱があるなら最強のものを選ぶ。無ければ何でもよい。 */
function bestSuit(variant: Variant, allowed: readonly Suit[]): Suit {
  const ranking = variant.deck.suitRanking;
  if (ranking) {
    for (const suit of ranking) {
      if (allowed.includes(suit)) return suit;
    }
  }
  return allowed[0]!;
}

/**
 * ワイルドを置き換えた手を、その役に限って列挙する。
 *
 * ワイルドが無ければ元の並びを1つだけ返すので、呼ぶ側は分岐しなくてよい。
 */
export function substitutionsForPattern(
  cards: readonly Card[],
  wildAt: readonly number[],
  pattern: HandPattern,
  variant: Variant,
): Card[][] {
  if (wildAt.length === 0) return [[...cards]];

  const allowed = wildAt.map((i) => allowedBy(cards[i]!, variant));
  const ranks = rankCandidates(pattern, variant.deck.ranks);

  // 同一スート条件があるなら、ワイルドは全員同じスートになる。
  // 1枚ずつ独立に選ばせると、同じ結果を何度も試すことになる。
  const sameSuit = pattern.global.some((g) => g.type === 'allSameSuit');

  const suitChoices: Suit[][] = sameSuit
    ? [variant.deck.suits.filter((s) => allowed.every((a) => a.suits.includes(s)))]
    : allowed.map((a) =>
        patternUsesSuits(pattern) ? [...a.suits] : [bestSuit(variant, a.suits)],
      );

  const perWildRanks = allowed.map((a) => ranks.filter((r) => a.ranks.includes(r)));

  const out: Card[][] = [];
  const current = [...cards];
  let produced = 0;

  const emit = () => {
    if (produced < MAX_SUBSTITUTIONS) {
      out.push([...current]);
      produced++;
    }
  };

  /** ワイルドどうしが交換可能なら、ランクの添字を増加方向に限る。 */
  const interchangeable = perWildRanks.every(
    (list) => list.length === perWildRanks[0]!.length && list.every((r, i) => r === perWildRanks[0]![i]),
  );

  const walkRanks = (depth: number, start: number, suits: readonly Suit[]): void => {
    if (produced >= MAX_SUBSTITUTIONS) return;
    if (depth === wildAt.length) {
      emit();
      return;
    }
    const slot = wildAt[depth]!;
    const list = perWildRanks[depth]!;
    const suit = suits[depth]!;
    for (let i = interchangeable ? start : 0; i < list.length; i++) {
      current[slot] = { rank: list[i]!, suit };
      walkRanks(depth + 1, i, suits);
    }
    current[slot] = cards[slot]!;
  };

  if (sameSuit) {
    for (const suit of suitChoices[0]!) {
      walkRanks(0, 0, wildAt.map(() => suit));
    }
  } else {
    // スートを1つずつ選ぶ（スートを見ない役なら各1通りなので実質1回）。
    const walkSuits = (depth: number, chosen: Suit[]): void => {
      if (depth === wildAt.length) {
        walkRanks(0, 0, chosen);
        return;
      }
      for (const suit of suitChoices[depth]!) walkSuits(depth + 1, [...chosen, suit]);
    };
    walkSuits(0, []);
  }

  return out;
}

/**
 * ワイルドを置き換えた手をすべて列挙する（役を限定しない素朴な版）。
 *
 * 遅いので対局では使わない。substitutionsForPattern が正しいことを
 * 確かめる differential テストの基準として残してある。
 */
export function allSubstitutions(cards: readonly Card[], variant: Variant): Card[][] {
  const wildAt = wildPositions(cards, variant);
  if (wildAt.length === 0) return [[...cards]];

  const choices = wildAt.map((i) => {
    const { ranks, suits } = allowedBy(cards[i]!, variant);
    const out: Card[] = [];
    for (const rank of ranks) {
      for (const suit of suits) out.push({ rank, suit });
    }
    return out;
  });

  const out: Card[][] = [];
  const current = [...cards];

  const walk = (depth: number): void => {
    if (depth === wildAt.length) {
      out.push([...current]);
      return;
    }
    const slot = wildAt[depth]!;
    for (const candidate of choices[depth]!) {
      current[slot] = candidate;
      walk(depth + 1);
    }
    current[slot] = cards[slot]!;
  };

  walk(0);
  return out;
}
