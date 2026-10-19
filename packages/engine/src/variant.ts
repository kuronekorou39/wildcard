import type { Card, HandStructure, ShowCardsPolicy, UsageRange, Variant } from './types.js';
import { PREFLOP } from './types.js';
import { buildDeck } from './deck.js';

/**
 * バリアントの検算。
 *
 * 「52枚で回るはず」が狂う原因は、だいたい手札の枚数・ストリートの枚数・
 * バーンカードの数え忘れのどれかである。遊び始めてから山札が尽きるより、
 * 作った時点で弾くほうがよい。
 */

/** 場に並ぶ最大枚数（バーンは含まない）。 */
export function boardSize(structure: HandStructure): number {
  return structure.streets.reduce((sum, street) => sum + street.cards, 0);
}

/**
 * 1ハンドで山札から消える枚数（バーン込み）。
 *
 * extra は、確率で余分に消えうる枚数。露出した札をバーンに使わない設定だと
 * 引き直しのぶん1枚多く要るので、そこを見込んでおかないと稀に山札が尽きる。
 */
export function requiredCards(
  structure: HandStructure,
  players: number,
  extra = 0,
): number {
  const burned = structure.streets.reduce((sum, street) => sum + (street.burn ?? 0), 0);
  return structure.holeCards * players + boardSize(structure) + burned + extra;
}

/** そのバリアントで余分に要りうる枚数。 */
export function extraCardsFor(variant: Variant): number {
  const mayExpose = exposedCardChanceOf(variant) > 0;
  return mayExpose && !exposedCardBecomesBurnOf(variant) ? 1 : 0;
}

/** 手札から使う枚数の許容範囲。省略時は「何枚でも」。 */
export function holeUsageOf(structure: HandStructure): UsageRange {
  return structure.holeUsage ?? { min: 0, max: structure.holeCards };
}

/** 場から使う枚数の許容範囲。省略時は「何枚でも」。 */
export function boardUsageOf(structure: HandStructure): UsageRange {
  return structure.boardUsage ?? { min: 0, max: boardSize(structure) };
}

/** ストリートの表示名。PREFLOP は場が開く前。 */
export function streetName(variant: Variant, streetIndex: number): string {
  if (streetIndex <= PREFLOP) return 'プリフロップ';
  return variant.structure.streets[streetIndex]?.name ?? '';
}

export interface VariantProblem {
  readonly field: string;
  readonly message: string;
}

/**
 * バリアントの矛盾を探す。問題がなければ空配列。
 *
 * players は実際に座る最大人数。デッキが足りるかはここで決まるので、
 * 人数を抜きに「このバリアントは正しい」とは言えない。
 */
export function validateVariant(variant: Variant, players: number): VariantProblem[] {
  const problems: VariantProblem[] = [];
  const { deck, structure } = variant;
  const at = (field: string, message: string) => problems.push({ field, message });

  // ---- デッキ ----
  if (deck.ranks.length === 0) at('deck.ranks', 'ランクが1つもない');
  if (deck.suits.length === 0 && (deck.overrides ?? []).length === 0) {
    at('deck.suits', 'スートが1つもない');
  }
  if (new Set(deck.ranks).size !== deck.ranks.length) {
    at('deck.ranks', '同じランクが重複している（強さの順序が決まらない）');
  }
  for (const override of deck.overrides ?? []) {
    if (!deck.ranks.includes(override.rank)) {
      at(
        'deck.overrides',
        `${override.rank} は ranks に無い。強さの順序が決まらないので使えない`,
      );
    }
    if (override.count < 0) at('deck.overrides', '枚数が負になっている');
  }

  // ---- 構造 ----
  if (structure.holeCards < 0) at('structure.holeCards', '手札の枚数が負');
  if (structure.handSize <= 0) at('structure.handSize', '役を作る枚数が0以下');
  for (const [i, street] of structure.streets.entries()) {
    if (street.cards < 0) at(`structure.streets[${i}]`, '開く枚数が負');
    if ((street.burn ?? 0) < 0) at(`structure.streets[${i}]`, '焼く枚数が負');
    if (street.name.trim() === '') at(`structure.streets[${i}]`, '名前が空');
  }

  const hole = holeUsageOf(structure);
  const board = boardUsageOf(structure);
  const total = boardSize(structure);

  if (hole.min > hole.max) at('structure.holeUsage', '下限が上限を超えている');
  if (board.min > board.max) at('structure.boardUsage', '下限が上限を超えている');
  if (hole.max > structure.holeCards) {
    at('structure.holeUsage', `手札は${structure.holeCards}枚しかないのに${hole.max}枚使う指定`);
  }
  if (board.max > total) {
    at('structure.boardUsage', `場は${total}枚しかないのに${board.max}枚使う指定`);
  }
  if (hole.max + board.max < structure.handSize) {
    at(
      'structure.handSize',
      `手札${hole.max}枚＋場${board.max}枚では${structure.handSize}枚の役を組めない`,
    );
  }
  if (hole.min + board.min > structure.handSize) {
    at(
      'structure.handSize',
      `手札${hole.min}枚＋場${board.min}枚は必ず使う指定だが、役は${structure.handSize}枚しかない`,
    );
  }

  // ---- 役 ----
  if (variant.ranking.hands.filter((hand) => hand.enabled).length === 0) {
    at('ranking.hands', '有効な役が1つもない');
  }
  const ids = variant.ranking.hands.map((hand) => hand.id);
  if (new Set(ids).size !== ids.length) at('ranking.hands', '役の id が重複している');
  for (const hand of variant.ranking.hands) {
    if (hand.pattern.cards.length > structure.handSize) {
      at(
        `ranking.hands[${hand.id}]`,
        `${hand.pattern.cards.length}枚の条件だが、役は${structure.handSize}枚しかない`,
      );
    }
  }

  // ---- デッキが足りるか ----
  if (players >= 1) {
    const need = requiredCards(structure, players);
    const have = buildDeck(deck).length;
    if (have < need) {
      at(
        'deck',
        `${players}人で遊ぶには${need}枚必要だが、デッキは${have}枚しかない` +
          `（手札${structure.holeCards}枚×${players}人 ＋ 場${total}枚 ＋ バーン${
            need - structure.holeCards * players - total
          }枚）`,
      );
    }
  }

  return problems;
}

/** 検算を通ったか。 */
export const isValidVariant = (variant: Variant, players: number): boolean =>
  validateVariant(variant, players).length === 0;

/** 何人まで座れるか。デッキの枚数から決まる。 */
export function maxPlayersFor(variant: Variant): number {
  const { structure } = variant;
  if (structure.holeCards <= 0) return Number.POSITIVE_INFINITY;
  const have = buildDeck(variant.deck).length;
  const fixed = requiredCards(structure, 0);
  return Math.max(0, Math.floor((have - fixed) / structure.holeCards));
}

// ============================================================
// 卓の作法
// ============================================================

/**
 * ディーラーが札を1枚だけ表にしてしまう確率。既定は0。
 * これはミスディールではなく、回収して引き直す手順になる。
 */
export const exposedCardChanceOf = (variant: Variant): number =>
  Math.min(1, Math.max(0, variant.options?.exposedCardChance ?? 0));

/**
 * 表にしてしまった札を最初のバーンに使うか。既定 true（Robert's Rules）。
 * false にすると別途山札からも焼くので、1ハンドで消える枚数が1枚増える。
 */
export const exposedCardBecomesBurnOf = (variant: Variant): boolean =>
  variant.options?.exposedCardBecomesBurn ?? true;

/** 配り直し（ミスディール）になる確率。既定は0。 */
export const misdealChanceOf = (variant: Variant): number =>
  Math.min(1, Math.max(0, variant.options?.misdealChance ?? 0));

/** 流れた後に配られるはずだった札を見せるか。 */
export const rabbitHuntEnabled = (variant: Variant): boolean =>
  variant.options?.rabbitHunt ?? false;

/** 自分の手札をどこまで見せられるか。 */
export const showCardsPolicyOf = (variant: Variant): ShowCardsPolicy =>
  variant.options?.showCards ?? 'none';

/**
 * 残りのストリートで配られるはずだったカード（ラビットハント）。
 *
 * 山札はすでに確定しているので、残りの段取りをそのままなぞるだけで出る。
 * バーンカードは飛ばす——実際に配っていたら焼かれていた札なので。
 */
export function rabbitCards(
  structure: HandStructure,
  streetIndex: number,
  deck: readonly Card[],
): Card[] {
  const out: Card[] = [];
  let cursor = 0;
  for (let i = streetIndex + 1; i < structure.streets.length; i++) {
    const street = structure.streets[i]!;
    cursor += street.burn ?? 0;
    for (let n = 0; n < street.cards; n++) {
      const card = deck[cursor++];
      if (card === undefined) return out; // 山札が尽きたらそこまで
      out.push(card);
    }
  }
  return out;
}
