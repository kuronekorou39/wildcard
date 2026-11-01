import { COLOR_SUITS, type Card, type CardColor, type HandPattern, type Rank, type Suit, type Variant } from '../types.js';
import { describeBlock, toBlocks } from './blocks.js';
import { buildDeck, cardKey, rankStep, rankValue, sequenceOf } from '../deck.js';
import { createRng } from '../rng.js';
import { type HandResult, evaluateExact } from './evaluate.js';
import { hasWilds, isWild, patternUsesSuits } from './wild.js';

/**
 * 役の「具体例」を作る。
 *
 * 条件式（X, X, Y, Y+1, Y+2）を見ても、人間は「で、それ何の手?」が分からない。
 * 編集画面はこれが無いと使えない。旧 poker-web-20250702 が
 * HouseRulesPage.tsx を3,651行まで膨らませて未完に終わったのも、
 * まさにここを作ろうとしていた途中だった。
 *
 * ## 今回が安く済む理由
 *
 * **候補を作って、既存の matchPattern / evaluateExact で確かめる。**
 * 生成側に「成立するか」の判断を持たせないので、判定ロジックと
 * 二重管理にならない。旧実装は生成を独立に書いたため、両者が
 * 食い違いうる構造になっていた。
 *
 * もう一つ大事なのは **「その役より強い役に当てはまらない」ことまで確かめる**
 * 点。これが無いと「ミニストレートの例」としてロイヤルフラッシュを出してしまう。
 * evaluateExact は強い順に見て最初に成立したものを返すので、
 * 返ってきた id が目的の役と一致すれば、それだけで条件を満たしている。
 */

/** 例を探す試行回数。1回あたり評価1回ぶんなので、多くても安い。 */
const MAX_ATTEMPTS = 400;

export interface ExampleOptions {
  /** 乱数の種。変えると別の例が出る。 */
  readonly seed?: number;
}

/**
 * その役がちょうど成立する手を1つ返す。見つからなければ null。
 *
 * 「ちょうど」というのは、**それより強い役には当てはまらない**という意味。
 */
export function exampleHand(
  variant: Variant,
  rankingId: string,
  options: ExampleOptions = {},
): Card[] | null {
  const ranking = variant.ranking.hands.find((h) => h.id === rankingId);
  if (!ranking || !ranking.enabled) return null;

  const { handSize } = variant.structure;
  const available = deckCounts(variant);
  const wilds = wildStock(variant);
  const rng = createRng((options.seed ?? 1) >>> 0);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const hand = buildCandidate(variant, ranking.pattern, handSize, available, wilds, rng);
    if (!hand) continue;

    // 生成側では「成立するか」を判断しない。本物の評価に聞く。
    const result = evaluateExact(hand, variant);
    if (result?.rankingId === rankingId) return arrange(hand, ranking.pattern, variant);
  }
  return null;
}

/** 有効な役それぞれの例。順位表に並べて見せるためのもの。 */
export function exampleHands(
  variant: Variant,
  options: ExampleOptions = {},
): Map<string, Card[] | null> {
  const out = new Map<string, Card[] | null>();
  for (const [i, ranking] of variant.ranking.hands.entries()) {
    if (!ranking.enabled) continue;
    // 役ごとに種をずらす。同じ種だと似た例ばかりになる。
    out.set(ranking.id, exampleHand(variant, ranking.id, { seed: (options.seed ?? 1) + i * 97 }));
  }
  return out;
}

// ============================================================
// 候補を作る
// ============================================================

/**
 * デッキにあるワイルドの札。
 *
 * ファイブカードのように、**ワイルドが無いと成立しない役**がある
 * （同じランクは4枚しかない）。実札で足りないときはここから補う。
 */
function wildStock(variant: Variant): Card[] {
  if (!hasWilds(variant)) return [];
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of buildDeck(variant.deck)) {
    if (!isWild(card, variant)) continue;
    const key = cardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

/** デッキに各カードが何枚あるか。例に同じ札を使いすぎないため。 */
function deckCounts(variant: Variant): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of buildDeck(variant.deck)) {
    const key = cardKey(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const pick = <T>(list: readonly T[], rng: () => number): T | undefined =>
  list.length === 0 ? undefined : list[Math.floor(rng() * list.length)];

/** 先頭をランダムにずらした並び。どれを先に試すかだけを無作為にする。 */
function rotate<T>(list: readonly T[], rng: () => number): T[] {
  const at = Math.floor(rng() * list.length);
  return [...list.slice(at), ...list.slice(0, at)];
}

function buildCandidate(
  variant: Variant,
  pattern: HandPattern,
  handSize: number,
  available: ReadonlyMap<string, number>,
  wilds: readonly Card[],
  rng: () => number,
): Card[] | null {
  const { ranks, suits } = variant.deck;
  if (ranks.length === 0 || suits.length === 0) return null;
  const sequence = sequenceOf(variant.deck);

  // 同じ名前の変数は同じランクを指し、違う名前は違うランクを指す。
  const bases = new Map<string, number>();
  const usedBases = new Set<number>();

  const resolveBase = (name: string, offset: number): number | null => {
    const existing = bases.get(name);
    if (existing !== undefined) return existing;

    // 相対指定は連続の順（既定は 2…A）で数える。基準から offset ぶん上の札が
    // すべてデッキにある位置だけを候補にする（5 を抜けば 3-4-5 は組めない）。
    const same = pattern.cards.filter((c) => c.rank.type === 'variable' && c.rank.name === name);
    const offsets = same.map((c) => (c.rank.type === 'variable' ? (c.rank.offset ?? 0) : 0));
    const wrap = same.some((c) => c.rank.type === 'variable' && c.rank.wrap === true);
    const candidates = sequence
      .map((_, i) => i)
      .filter((i) => !usedBases.has(i) && offsets.every((o) => {
        const rank = sequence[wrap ? (i + o) % sequence.length : i + o];
        return rank !== undefined && ranks.includes(rank);
      }));
    const base = pick(candidates, rng);
    if (base === undefined) return null;

    bases.set(name, base);
    usedBases.add(base);
    return base;
  };

  // 同一スート条件があるなら、全部そのスートで揃える。
  const sameSuit = pattern.global.some((g) => g.type === 'allSameSuit');
  // 色の条件があるなら、使えるスートをその色に絞る。「同じ色」なら色を1つ選ぶ。
  const colorRule = pattern.global.find((g) => g.type === 'color');
  const sameColor = pattern.global.some((g) => g.type === 'allSameColor');
  const color: CardColor | undefined = colorRule?.type === 'color' ? colorRule.color : sameColor ? pick(['red', 'black'] as const, rng) : undefined;
  const colorSuits = color === undefined ? suits : suits.filter((s) => COLOR_SUITS[color].includes(s));
  const lockedSuit = sameSuit ? pick(colorSuits, rng) : undefined;
  // 「赤が N 枚以上」は、先頭から N 枚をその色にする。
  const colorCount = pattern.global.find((g) => g.type === 'colorCount');
  // スートのまとまりは、まとまりごとに違うスートを1つずつ選ぶ。
  const groupSuits = new Map<string, Suit>();
  const groupSuit = (group: string, allowed: readonly Suit[]): Suit | undefined => {
    const existing = groupSuits.get(group);
    if (existing !== undefined) return existing;
    const taken = new Set(groupSuits.values());
    const suit = pick(allowed.filter((s) => !taken.has(s)), rng);
    if (suit !== undefined) groupSuits.set(group, suit);
    return suit;
  };

  // スートが結果に関わらない役では、散らしたほうが読みやすい。
  // ストレートの例が 10♣ J♣ Q♥ K♣ A♦ だと、フラッシュに見えてしまう。
  // 逆に「同じスートが3枚以上」のような条件がある役で散らすと
  // 成立しなくなるので、スートを見る役では触らない。
  // 「スートが N 種類以上」は散らすほど成立しやすいので、散らす。
  const spreadSuits = !patternUsesSuits(pattern) || pattern.global.some((g) => g.type === 'suitKinds');

  const used = new Map<string, number>();
  const take = (card: Card): boolean => {
    const key = cardKey(card);
    const have = available.get(key) ?? 0;
    const taken = used.get(key) ?? 0;
    if (taken >= have) return false;
    used.set(key, taken + 1);
    return true;
  };

  const hand: Card[] = [];

  for (const [index, cond] of pattern.cards.entries()) {
    let allowedSuits: readonly Suit[] = (cond.suits.length > 0 ? cond.suits : suits).filter((s) => colorSuits.includes(s));
    if (colorCount?.type === 'colorCount' && index < colorCount.count) allowedSuits = allowedSuits.filter((s) => COLOR_SUITS[colorCount.color].includes(s));
    if (cond.suitGroup !== undefined) {
      const suit = groupSuit(cond.suitGroup, allowedSuits);
      if (suit === undefined) return null;
      allowedSuits = [suit];
    }
    if (allowedSuits.length === 0) return null;
    if (lockedSuit !== undefined && !allowedSuits.includes(lockedSuit)) return null;

    // 条件を満たす札を1つに決め打ちせず、空いているものを順に試す。
    // 1つ試して諦めると「フォーカードなのに3枚しか揃っていない」
    // 「フラッシュなのにジョーカー頼み」といった読めない例になる。
    let rankOrder: Rank[];
    switch (cond.rank.type) {
      case 'fixed':
        rankOrder = ranks.includes(cond.rank.value) ? [cond.rank.value] : [];
        break;
      case 'oneOf':
        rankOrder = rotate(
          cond.rank.values.filter((r) => ranks.includes(r)),
          rng,
        );
        break;
      case 'variable': {
        const base = resolveBase(cond.rank.name, cond.rank.offset ?? 0);
        if (base === null) return null;
        const at = base + (cond.rank.offset ?? 0);
        const resolved = sequence[cond.rank.wrap ? at % sequence.length : at];
        // 同じ変数は同じランクを指すので、ここは代案を出せない。
        rankOrder = resolved === undefined ? [] : [resolved];
        break;
      }
      case 'any':
        rankOrder = rotate(ranks, rng);
        break;
    }
    if (rankOrder.length === 0) return null;

    let suitOrder = lockedSuit !== undefined ? [lockedSuit] : rotate(allowedSuits, rng);
    if (spreadSuits && lockedSuit === undefined) {
      const taken = new Set(hand.map((c) => c.suit));
      suitOrder = [...suitOrder].sort((a, b) => Number(taken.has(a)) - Number(taken.has(b)));
    }
    const card = rankOrder.flatMap((rank) => suitOrder.map((suit) => ({ rank, suit }))).find(take);
    if (card) {
      hand.push(card);
      continue;
    }

    // 条件を満たす実札が1枚も残っていない。ワイルドがあるなら代わりに使う。
    // ファイブカードのように、これが無いと作れない役がある。
    const wild = wilds.find(take);
    if (!wild) return null;
    hand.push(wild);
  }

  // 残りはキッカー。役を強くしてしまわないよう、
  // 同じランクや同じスートが重ならないものを優先する。
  while (hand.length < handSize) {
    // 1枚引くごとに選び直す。最初に一度だけ並べると、引くほど偏って
    // ハイカードの例が 7♥ 2♠ 3♠ 4♠ 10♠ のようになる。
    const card = pickFiller(variant, hand, available, used, rng);
    if (card === undefined || !take(card)) return null;
    hand.push(card);
  }

  return hand;
}

/**
 * 読みやすい並びに直す。
 *
 * 生成した順のままだと `2♥ J♣ K♣ 5♣ 3♥` のように散らばって、
 * 何が条件を満たしているのか目で追えない。
 *
 * **条件の順は崩さない。** フルハウスは3枚組→2枚組の順で並んでいて、
 * その並び自体が役の説明になっている。ランクで一律に並べ替えると
 * それが消えるので、**同じ条件が続いている区間の中だけ**で並べ替える。
 * 条件を満たす札が先、キッカーが後、という関係もそのまま保つ。
 *
 * **左が強い。** 区間の中は強い順に並べる。ストレートのように1枚ずつの条件が
 * 下から順に続く並び（X, X+1, … や 10 J Q K A）は、その並びごと逆にする。
 * こうすると 10 J Q K A は A K Q J 10、ホイールは 5 4 3 2 A になる。
 */
function arrange(hand: readonly Card[], pattern: HandPattern, variant: Variant): Card[] {
  const specOf = (i: number): string => JSON.stringify(pattern.cards[i]);

  // 同じ条件が続く区間の区切り。[0, 3, 5] のような境界の列になる。
  const bounds: number[] = [0];
  for (let i = 1; i < pattern.cards.length; i++) {
    if (specOf(i) !== specOf(i - 1)) bounds.push(i);
  }
  bounds.push(pattern.cards.length);
  if (pattern.cards.length < hand.length) bounds.push(hand.length); // キッカーの区間

  const byRank = (a: Card, b: Card): number => {
    // ワイルドのランクは飾りなので、並べる材料にならない。後ろへ送る。
    const aw = isWild(a, variant) ? 1 : 0;
    const bw = isWild(b, variant) ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return rankValue(a.rank, variant.deck) - rankValue(b.rank, variant.deck);
  };

  const sections: { cards: Card[]; spec: HandPattern['cards'][number] | undefined }[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    sections.push({
      cards: hand.slice(bounds[i]!, bounds[i + 1]!).sort((a, b) => -byRank(a, b) || 0).sort(wildsLast),
      spec: pattern.cards[bounds[i]!],
    });
  }

  // 何の条件も無い「任意」の札がキッカーの直前にあるなら、キッカーとまとめて強い順にする。
  // ハイカードは「任意1枚＋キッカー4枚」なので、そのままだと 9 A 8 6 2 のように並ぶ。
  const isFree = (section: (typeof sections)[number]) =>
    section.spec === undefined || (section.spec.rank.type === 'any' && section.spec.suits.length === 0);
  if (sections.length > 1 && sections[sections.length - 1]!.spec === undefined) {
    let from = sections.length - 1;
    while (from > 0 && isFree(sections[from - 1]!)) from--;
    if (from < sections.length - 1) {
      const merged = sections.splice(from).flatMap((section) => section.cards);
      sections.push({ cards: merged.sort((a, b) => -byRank(a, b) || 0).sort(wildsLast), spec: undefined });
    }
  }

  // 1枚ずつの区間が続く並び（同じ変数の相対指定、または決まったランクの列）を逆にする。
  const runKey = (section: (typeof sections)[number]): string | null => {
    if (section.cards.length !== 1 || !section.spec) return null;
    const rank = section.spec.rank;
    return rank.type === 'variable' ? `var:${rank.name}` : rank.type === 'fixed' ? 'fixed' : null;
  };
  const ordered: (typeof sections)[number][] = [];
  for (let i = 0; i < sections.length; ) {
    const key = runKey(sections[i]!);
    let j = i + 1;
    while (key !== null && j < sections.length && runKey(sections[j]!) === key) j++;
    const group = sections.slice(i, j);
    ordered.push(...(group.length > 1 ? group.reverse() : group));
    i = j;
  }
  return ordered.flatMap((section) => section.cards);

  function wildsLast(a: Card, b: Card): number {
    return (isWild(a, variant) ? 1 : 0) - (isWild(b, variant) ? 1 : 0);
  }
}

/**
 * キッカーを1枚選ぶ。
 *
 * 適当に埋めると、たまたまペアやフラッシュになって「もっと強い役」に
 * なってしまい、やり直しが増える。いま手にある札と最も噛み合わない
 * ものだけを候補にして、その中から引く。
 */
function pickFiller(
  variant: Variant,
  hand: readonly Card[],
  available: ReadonlyMap<string, number>,
  used: ReadonlyMap<string, number>,
  rng: () => number,
): Card | undefined {
  const { ranks, suits } = variant.deck;
  const usedRanks = new Set(hand.map((c) => c.rank));
  const suitCounts = new Map<Suit, number>();
  for (const card of hand) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);

  /** 手札と噛み合いにくいほど小さい。 */
  const score = (card: Card): number => {
    let n = 0;
    if (usedRanks.has(card.rank)) n += 8; // ペアを作ってしまう
    n += (suitCounts.get(card.suit) ?? 0) * 2; // 同じスートが増えるとフラッシュに寄る
    const near = hand.some((c) => Math.abs(rankStep(c.rank, variant.deck) - rankStep(card.rank, variant.deck)) <= 2);
    if (near) n += 3; // ストレートに寄る
    return n;
  };

  let best = Number.POSITIVE_INFINITY;
  let tied: Card[] = [];
  for (const rank of ranks) {
    for (const suit of suits) {
      const card = { rank, suit };
      const key = cardKey(card);
      if ((used.get(key) ?? 0) >= (available.get(key) ?? 0)) continue;

      const n = score(card);
      if (n < best) {
        best = n;
        tied = [card];
      } else if (n === best) {
        tied.push(card);
      }
    }
  }
  return pick(tied, rng);
}

// ============================================================
// ワイルドが何に化けたか
// ============================================================

export interface WildResolution {
  /** 手の中の位置。 */
  readonly index: number;
  /** 引いた札そのもの（ジョーカー、ワイルド指定のランクなど）。 */
  readonly card: Card;
  /** その札が化けた先。 */
  readonly becomes: Card;
  /**
   * その役でスートに意味があるか。false なら becomes のスートは
   * 便宜的に決めただけなので、画面にはランクだけ出すべき。
   */
  readonly suitMatters: boolean;
}

/**
 * 評価結果から「このジョーカーは K♠ になった」を取り出す。
 *
 * ワイルドを含む手は、札を見ただけでは何の役か読めない。
 * 「J J J 2 2 がファイブカード」と言われても、2 がワイルドで J に
 * なったことが見えないと納得できない。
 */
export function wildResolutions(result: HandResult, variant: Variant): WildResolution[] {
  if (!hasWilds(variant)) return [];
  const ranking = variant.ranking.hands.find((h) => h.id === result.rankingId);
  const suitMatters = ranking ? patternUsesSuits(ranking.pattern) : true;

  const out: WildResolution[] = [];
  for (const [index, card] of result.cards.entries()) {
    if (!isWild(card, variant)) continue;
    const becomes = result.resolved[index];
    // 置き換えが無い（その役がワイルドを使わなかった）なら出さない。
    if (!becomes || cardKey(becomes) === cardKey(card)) continue;
    out.push({ index, card, becomes, suitMatters });
  }
  return out;
}

// ============================================================
// 条件を日本語にする
// ============================================================

/** 役の条件を一文で説明する。 */
export function describePattern(pattern: HandPattern): string {
  const parts: string[] = [];

  // まとまりで言い表せるなら、その言い方を使う（スート・飛ばし・回り込みまで書ける）。
  const blocks = toBlocks(pattern);
  if (blocks) parts.push(...blocks.map(describeBlock));
  else describeCards(pattern, parts);

  for (const global of pattern.global) {
    switch (global.type) {
      case 'allSameSuit':
        parts.push('すべて同じスート');
        break;
      case 'allDifferentSuit':
        parts.push('すべて違うスート');
        break;
      case 'suitCount':
        parts.push(`同じスートが${global.count}枚以上`);
        break;
      case 'consecutive':
        parts.push(global.wrap ? 'ランクが連続（回り込みあり）' : 'ランクが連続');
        break;
      case 'allDifferentRank':
        parts.push('すべて違うランク');
        break;
      case 'allSameColor':
        parts.push('すべて同じ色');
        break;
      case 'color':
        parts.push(global.color === 'red' ? 'すべて赤' : 'すべて黒');
        break;
      case 'colorCount':
        parts.push(`${global.color === 'red' ? '赤' : '黒'}が${global.count}枚以上`);
        break;
      case 'suitKinds':
        parts.push(global.count >= 4 ? '4つのスートがそろう' : `スートが${global.count}種類以上`);
        break;
    }
  }

  return parts.length > 0 ? parts.join('、') : '条件なし';
}

/** まとまりで言い表せない役は、条件の種類ごとに数えて言う。 */
function describeCards(pattern: HandPattern, parts: string[]): void {

  // 同じ変数名のまとまりごとにまとめる。X,X,X なら「同じランクが3枚」。
  const groups = new Map<string, number[]>();
  const fixedRanks: Rank[] = [];
  const oneOfParts: string[] = [];
  let anyCount = 0;

  for (const cond of pattern.cards) {
    switch (cond.rank.type) {
      case 'variable': {
        const list = groups.get(cond.rank.name) ?? [];
        list.push(cond.rank.offset ?? 0);
        groups.set(cond.rank.name, list);
        break;
      }
      case 'fixed':
        fixedRanks.push(cond.rank.value);
        break;
      case 'oneOf':
        oneOfParts.push(cond.rank.values.join('・'));
        break;
      case 'any':
        anyCount++;
        break;
    }
  }

  for (const offsets of groups.values()) {
    const sorted = [...offsets].sort((a, b) => a - b);
    const allZero = sorted.every((o) => o === 0);
    const consecutive = sorted.every((o, i) => o === i);

    if (allZero) parts.push(`同じランクが${sorted.length}枚`);
    else if (consecutive) parts.push(`連続する${sorted.length}枚`);
    else parts.push(`決まった間隔の${sorted.length}枚`);
  }

  if (fixedRanks.length > 0) parts.push(`${fixedRanks.join(' ')} の${fixedRanks.length}枚`);
  if (oneOfParts.length > 0) {
    // 同じ候補が並ぶのが普通なので、一度だけ書く。
    const unique = [...new Set(oneOfParts)];
    parts.push(`${unique.join(' / ')} から${oneOfParts.length}枚`);
  }
  if (anyCount > 0) parts.push(`任意の${anyCount}枚`);
}

/**
 * ワイルドの指定を一文にする。ワイルドが無ければ null。
 *
 * 順位表に「デッキ 53枚」とだけ出ていても、その1枚が何なのか分からない。
 */
export function describeWilds(variant: Variant): string | null {
  const configured = variant.ranking.wilds ?? [];
  // ジョーカーは規則が無くても何にでも化ける（→ wild.ts）。その分も説明に入れる。
  const defaultJoker = (variant.deck.jokers ?? 0) > 0 && !configured.some((rule) => rule.cards.kind === 'joker');
  const rules = defaultJoker ? [...configured, { cards: { kind: 'joker' as const } }] : configured;
  if (rules.length === 0) return null;

  const parts = rules.map((rule) => {
    const selector = rule.cards;
    const target =
      selector.kind === 'joker'
        ? 'ジョーカー'
        : selector.kind === 'rank'
          ? selector.ranks.join('・')
          : selector.cards.map((c) => `${SUIT_NAME[c.suit]}の${c.rank}`).join('・');

    // 化ける先に制限があるなら書く。無制限のほうが普通なので、
    // 何も書かなければ「何にでも化ける」の意味になる。
    const becomes = rule.becomes;
    const limits: string[] = [];
    if (becomes?.ranks) limits.push(becomes.ranks.join('・'));
    if (becomes?.suits) limits.push(describeSuits(becomes.suits));

    return limits.length > 0 ? `${target}（${limits.join(' / ')}にのみ化ける）` : target;
  });

  return `${parts.join('、')}がワイルド`;
}

/** スートの一覧を日本語にする。 */
export const describeSuits = (suits: readonly Suit[]): string =>
  suits.map((s) => SUIT_NAME[s]).join('・');

const SUIT_NAME: Record<Suit, string> = {
  spades: 'スペード',
  hearts: 'ハート',
  diamonds: 'ダイヤ',
  clubs: 'クラブ',
};
