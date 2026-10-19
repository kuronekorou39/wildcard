import {
  RANKS,
  SUITS,
  type BettingRules,
  type CardCondition,
  type HandRanking,
  type HandStructure,
  type Rank,
  type Variant,
} from '../types.js';

// ---- 役の条件を書くための小道具 ----

/** 任意のカード1枚。 */
const any = (): CardCondition => ({ rank: { type: 'any' }, suits: [] });

/** 変数ランク。同名なら同ランク、offset で相対指定。 */
const v = (name: string, offset?: number): CardCondition => ({
  rank: offset === undefined ? { type: 'variable', name } : { type: 'variable', name, offset },
  suits: [],
});

/** 特定のランク。 */
const fixed = (value: Rank): CardCondition => ({ rank: { type: 'fixed', value }, suits: [] });

/** 指定したランクのいずれか。「素数のランク」のような役に使う。 */
const oneOf = (...values: Rank[]): CardCondition => ({ rank: { type: 'oneOf', values }, suits: [] });

/** 連続する5枚。X を最弱の札として X, X+1, X+2, X+3, X+4。 */
const run5 = (): CardCondition[] => [v('X'), v('X', 1), v('X', 2), v('X', 3), v('X', 4)];

// ---- 構造とベッティングの既製品 ----

/**
 * テキサスホールデムの構造。
 *
 * バーンカードを明示している。結果の確率分布は変わらないが、
 * 1ハンドで消える枚数が変わるので、デッキの検算に効く。
 */
export const HOLDEM_STRUCTURE: HandStructure = {
  holeCards: 2,
  streets: [
    { name: 'フロップ', cards: 3, burn: 1 },
    { name: 'ターン', cards: 1, burn: 1 },
    { name: 'リバー', cards: 1, burn: 1 },
  ],
  handSize: 5,
};

export const NO_LIMIT: BettingRules = { limit: 'no-limit' };

// ---- 標準の役 ----

/**
 * 標準のテキサスホールデムの役。**強い順**。
 *
 * ここで重要なのは、標準ルールもまた単なるデータとして表現されていること。
 * エンジン側には「フラッシュ」「ストレート」といった概念が一切存在しない。
 *
 * A-2-3-4-5（ホイール）は変数の相対指定では表せない（A の上に札がない）ため、
 * 固定ランクの独立した役として定義する。通常のストレートより下の順位に置くことで
 * 「ホイールは最弱のストレート」という標準の扱いが順位だけで再現される。
 */
export const STANDARD_HAND_RANKINGS: readonly HandRanking[] = [
  {
    id: 'royal_flush',
    name: 'ロイヤルフラッシュ',
    enabled: true,
    pattern: {
      cards: [fixed('10'), fixed('J'), fixed('Q'), fixed('K'), fixed('A')],
      global: [{ type: 'allSameSuit' }],
    },
  },
  {
    id: 'straight_flush',
    name: 'ストレートフラッシュ',
    enabled: true,
    pattern: { cards: run5(), global: [{ type: 'allSameSuit' }] },
  },
  {
    id: 'steel_wheel',
    name: 'ストレートフラッシュ（ホイール）',
    enabled: true,
    pattern: {
      cards: [fixed('A'), fixed('2'), fixed('3'), fixed('4'), fixed('5')],
      global: [{ type: 'allSameSuit' }],
    },
  },
  {
    id: 'four_of_a_kind',
    name: 'フォーカード',
    enabled: true,
    pattern: { cards: [v('X'), v('X'), v('X'), v('X')], global: [] },
  },
  {
    id: 'full_house',
    name: 'フルハウス',
    enabled: true,
    pattern: { cards: [v('X'), v('X'), v('X'), v('Y'), v('Y')], global: [] },
  },
  {
    id: 'flush',
    name: 'フラッシュ',
    enabled: true,
    pattern: {
      cards: [any(), any(), any(), any(), any()],
      global: [{ type: 'allSameSuit' }],
    },
  },
  {
    id: 'straight',
    name: 'ストレート',
    enabled: true,
    pattern: { cards: run5(), global: [] },
  },
  {
    id: 'wheel',
    name: 'ストレート（ホイール）',
    enabled: true,
    pattern: {
      cards: [fixed('A'), fixed('2'), fixed('3'), fixed('4'), fixed('5')],
      global: [],
    },
  },
  {
    id: 'three_of_a_kind',
    name: 'スリーカード',
    enabled: true,
    pattern: { cards: [v('X'), v('X'), v('X')], global: [] },
  },
  {
    id: 'two_pair',
    name: 'ツーペア',
    enabled: true,
    pattern: { cards: [v('X'), v('X'), v('Y'), v('Y')], global: [] },
  },
  {
    id: 'one_pair',
    name: 'ワンペア',
    enabled: true,
    pattern: { cards: [v('X'), v('X')], global: [] },
  },
  {
    id: 'high_card',
    name: 'ハイカード',
    enabled: true,
    pattern: { cards: [any()], global: [] },
  },
];

/** 標準のテキサスホールデム。すべての変種はこれを起点に編集していく。 */
export const STANDARD_VARIANT: Variant = {
  id: 'standard',
  name: 'テキサスホールデム（標準）',
  description: '52枚のデッキ、手札2枚、よく知られた9種類の役。迷ったらこれ。',
  deck: { suits: SUITS, ranks: RANKS },
  structure: HOLDEM_STRUCTURE,
  betting: NO_LIMIT,
  ranking: { hands: STANDARD_HAND_RANKINGS },
};

export {
  any as anyCard,
  fixed as fixedRank,
  oneOf as oneOfRanks,
  run5,
  v as variableRank,
};
