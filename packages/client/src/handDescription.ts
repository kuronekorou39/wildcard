import { patternUsesSuits, rankValue, type Card, type HandResult, type Rank, type Suit, type Variant } from '@wildcard/engine';

const SUIT_MARK: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

export interface HandDescription {
  /** 役の名前と、揃った札のランク。例) フォーカード（Q） */
  readonly main: string;
  /** キッカーとワイルドの化け先。無ければ空。例) キッカー A · ジョーカー→A */
  readonly detail: string;
}

/**
 * 役を、勝ち負けの理由が読める言葉にする。
 *
 * 「フォーカード」だけでは、同じフォーカードどうしでキッカーの差で負けたことが分からない。
 * ジョーカーが何に化けたかも書かないと、なぜその札がキッカーになったのか読めない。
 */
export function describeHand(result: HandResult, variant: Variant): HandDescription {
  const strongerFirst = (a: Card, b: Card) => rankValue(b.rank, variant.deck) - rankValue(a.rank, variant.deck);

  // 揃った札：枚数の多いランクから（フルハウスなら3枚のほう、ツーペアなら強いほう）。
  const counts = new Map<Rank, number>();
  for (const card of result.matched) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const groups = [...counts].filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || rankValue(b[0], variant.deck) - rankValue(a[0], variant.deck))
    .map(([rank]) => rank);
  const core = groups.length > 0 ? groups : result.matched.length === 1 ? [result.matched[0]!.rank] : [];
  const main = core.length > 0 ? `${result.rankingName}（${core.join('・')}）` : result.rankingName;

  const parts: string[] = [];
  if (result.kickers.length > 0) parts.push(`キッカー ${[...result.kickers].sort(strongerFirst).map((c) => c.rank).join('・')}`);

  // ワイルドの化け先。スートを見ない役ではランクだけ書く（同じ札が手にあっても嘘に見えない）。
  const pattern = variant.ranking.hands[result.rankingIndex]?.pattern;
  const withSuit = pattern ? patternUsesSuits(pattern) : true;
  result.cards.forEach((card, i) => {
    const becomes = result.resolved[i];
    if (!becomes || becomes === card) return;
    const from = card.joker !== undefined ? 'ジョーカー' : `${card.rank}${SUIT_MARK[card.suit]}`;
    parts.push(`${from}→${becomes.rank}${withSuit ? SUIT_MARK[becomes.suit] : ''}`);
  });

  return { main, detail: parts.join(' · ') };
}
