import { RANKS, SUITS, type CardCondition, type HandRanking, type Rank, type RuleSet } from '../types.js';

/** 任意のカード1枚。 */
const any = (): CardCondition => ({ rank: { type: 'any' }, suits: [] });

/** 変数ランク。同名なら同ランク、offset で相対指定。 */
const v = (name: string, offset?: number): CardCondition => ({
  rank: offset === undefined ? { type: 'variable', name } : { type: 'variable', name, offset },
  suits: [],
});

/** 特定のランク。 */
const fixed = (value: Rank): CardCondition => ({ rank: { type: 'fixed', value }, suits: [] });

/** 連続する5枚。X を最弱の札として X, X+1, X+2, X+3, X+4。 */
const run5 = (): CardCondition[] => [v('X'), v('X', 1), v('X', 2), v('X', 3), v('X', 4)];

/**
 * 標準のテキサスホールデムの役。**強い順**。
 *
 * ここで重要なのは、標準ルールもまた単なるデータとして表現されていることである。
 * エンジン側には「フラッシュ」「ストレート」といった概念が一切存在しない（原則4）。
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
    pattern: { cards: [fixed('10'), fixed('J'), fixed('Q'), fixed('K'), fixed('A')], global: [{ type: 'allSameSuit' }] },
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
    pattern: { cards: [fixed('A'), fixed('2'), fixed('3'), fixed('4'), fixed('5')], global: [{ type: 'allSameSuit' }] },
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
    pattern: { cards: [any(), any(), any(), any(), any()], global: [{ type: 'allSameSuit' }] },
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
    pattern: { cards: [fixed('A'), fixed('2'), fixed('3'), fixed('4'), fixed('5')], global: [] },
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

/** 標準のテキサスホールデム。カスタムルールはこれを起点に編集していく。 */
export const STANDARD_RULESET: RuleSet = {
  id: 'standard',
  name: 'テキサスホールデム（標準）',
  description: '52枚のデッキ、よく知られた9種類の役。迷ったらこれ。',
  deck: { suits: SUITS, ranks: RANKS },
  handRankings: STANDARD_HAND_RANKINGS,
};

export { any as anyCard, fixed as fixedRank, run5, v as variableRank };
