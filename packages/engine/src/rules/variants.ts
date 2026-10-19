import { RANKS, SUITS, type HandRanking, type Rank, type RuleSet } from '../types.js';
import { STANDARD_HAND_RANKINGS, STANDARD_RULESET, fixedRank, run5, variableRank } from './presets.js';

/**
 * ルールのプリセット。
 *
 * どれもエンジンのコードには一行も手を入れず、RuleSet というデータだけで
 * 表現されている（原則4）。「カスタムルール対応」が後付け機能ではなく
 * 唯一の経路であることが、ここで実際に確かめられる。
 */

// ---- 組み立ての小道具 ----

/** 指定した役を、別の役の直前（＝一つ強い順位）へ移す。 */
function moveBefore(
  rankings: readonly HandRanking[],
  moveId: string,
  beforeId: string,
): HandRanking[] {
  const item = rankings.find((r) => r.id === moveId);
  if (!item) throw new Error(`役が見つからない: ${moveId}`);
  const rest = rankings.filter((r) => r.id !== moveId);
  const at = rest.findIndex((r) => r.id === beforeId);
  if (at < 0) throw new Error(`役が見つからない: ${beforeId}`);
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** 指定した役を無効にする。順位からは消さず enabled だけ落とす。 */
function disable(rankings: readonly HandRanking[], ...ids: readonly string[]): HandRanking[] {
  const targets = new Set(ids);
  return rankings.map((r) => (targets.has(r.id) ? { ...r, enabled: false } : r));
}

/** 指定した役のパターンを差し替える。 */
function replacePattern(
  rankings: readonly HandRanking[],
  id: string,
  name: string,
  cards: readonly Rank[],
): HandRanking[] {
  return rankings.map((r) =>
    r.id === id
      ? { ...r, name, pattern: { ...r.pattern, cards: cards.map((rank) => fixedRank(rank)) } }
      : r,
  );
}

// ---- プリセット ----

/**
 * ショートデッキ（6+ホールデム）。
 *
 * 6未満を抜いた36枚で遊ぶ。枚数が減るとフラッシュが出にくくなり、
 * フルハウスのほうが出やすくなるので、**フラッシュがフルハウスより強い**。
 * 最弱のストレートも A-2-3-4-5 ではなく A-6-7-8-9 になる。
 */
const SHORT_DECK_RANKINGS = moveBefore(
  replacePattern(
    replacePattern(
      STANDARD_HAND_RANKINGS,
      'steel_wheel',
      'ストレートフラッシュ（A-6-7-8-9）',
      ['A', '6', '7', '8', '9'],
    ),
    'wheel',
    'ストレート（A-6-7-8-9）',
    ['A', '6', '7', '8', '9'],
  ),
  'flush',
  'full_house',
);

export const SHORT_DECK: RuleSet = {
  id: 'short-deck',
  name: 'ショートデッキ（6+）',
  description:
    '2〜5を抜いた36枚。フラッシュが出にくくなるのでフルハウスより強く、最弱のストレートは A-6-7-8-9。',
  deck: { suits: SUITS, ranks: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] },
  handRankings: SHORT_DECK_RANKINGS,
};

/**
 * エースが最弱。
 *
 * A-2-3-4-5 が普通のストレートになり、一番強いストレートは 9-10-J-Q-K。
 * 10-J-Q-K-A はもう連続していないので、ロイヤルフラッシュと
 * A-2-3-4-5 の特例役はどちらも無効にする。
 * 変数の相対指定（X, X+1, ...）がランクの並び順をそのまま見ているので、
 * 役のパターンを書き換えなくても正しく動く。
 */
export const ACE_LOW: RuleSet = {
  id: 'ace-low',
  name: 'エースが最弱',
  description:
    'A が一番弱い札になる。A-2-3-4-5 が普通のストレートになり、最強のストレートは 9-10-J-Q-K。',
  deck: {
    suits: SUITS,
    ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
  },
  handRankings: disable(STANDARD_HAND_RANKINGS, 'royal_flush', 'steel_wheel', 'wheel'),
};

/**
 * スートに強弱をつける。
 *
 * スペード > ハート > ダイヤ > クラブ。同じ役・同じランクでも必ず決着がつき、
 * 引き分けのチョップが起きなくなる。
 */
export const SUIT_RANKED: RuleSet = {
  id: 'suit-ranked',
  name: 'スートに強弱あり',
  description: 'スペード > ハート > ダイヤ > クラブ。引き分けのチョップが起きなくなる。',
  deck: {
    suits: SUITS,
    ranks: RANKS,
    suitRanking: ['spades', 'hearts', 'diamonds', 'clubs'],
  },
  handRankings: STANDARD_HAND_RANKINGS,
};

/** フラッシュがフルハウスより強い。順位の入れ替えだけで成立する。 */
export const FLUSH_OVER_FULL_HOUSE: RuleSet = {
  ...STANDARD_RULESET,
  id: 'flush-over-boat',
  name: 'フラッシュ > フルハウス',
  description: '52枚のまま、フラッシュだけをフルハウスより強くする。',
  handRankings: moveBefore(STANDARD_HAND_RANKINGS, 'flush', 'full_house'),
};

/**
 * 独自の役を足したルール。
 *
 * Wildcard でしかできないことの見本。どちらも変数の相対指定で書いてある。
 * - ミニストレート: 連続する3枚（X, X+1, X+2）。ワンペアより強い
 * - ペア＋三連: ペアと連続3枚（X, X, Y, Y+1, Y+2）。ツーペアより強い
 */
const MINI_STRAIGHT: HandRanking = {
  id: 'mini_straight',
  name: 'ミニストレート（3枚連続）',
  enabled: true,
  pattern: {
    cards: [variableRank('X'), variableRank('X', 1), variableRank('X', 2)],
    global: [],
  },
};

const PAIR_PLUS_RUN: HandRanking = {
  id: 'pair_plus_run',
  name: 'ペア＋三連',
  enabled: true,
  pattern: {
    cards: [
      variableRank('X'),
      variableRank('X'),
      variableRank('Y'),
      variableRank('Y', 1),
      variableRank('Y', 2),
    ],
    global: [],
  },
};

function insertBefore(
  rankings: readonly HandRanking[],
  ranking: HandRanking,
  beforeId: string,
): HandRanking[] {
  const at = rankings.findIndex((r) => r.id === beforeId);
  if (at < 0) throw new Error(`役が見つからない: ${beforeId}`);
  return [...rankings.slice(0, at), ranking, ...rankings.slice(at)];
}

export const HOUSE_HANDS: RuleSet = {
  ...STANDARD_RULESET,
  id: 'house-hands',
  name: '独自役入り（ミニストレート・ペア＋三連）',
  description:
    '標準の役に2つ足す。3枚連続（ワンペアより上）と、ペア＋連続3枚（ツーペアより上）。',
  handRankings: insertBefore(
    insertBefore(STANDARD_HAND_RANKINGS, PAIR_PLUS_RUN, 'two_pair'),
    MINI_STRAIGHT,
    'one_pair',
  ),
};

/** 選べるルールの一覧。UI はこれを並べる。 */
export const RULE_PRESETS: readonly RuleSet[] = [
  STANDARD_RULESET,
  SHORT_DECK,
  FLUSH_OVER_FULL_HOUSE,
  ACE_LOW,
  SUIT_RANKED,
  HOUSE_HANDS,
];

export function findPreset(id: string): RuleSet | undefined {
  return RULE_PRESETS.find((preset) => preset.id === id);
}

/** 有効な役を強い順に並べた一覧。ルールの説明表示に使う。 */
export function activeRankings(ruleSet: RuleSet): readonly HandRanking[] {
  return ruleSet.handRankings.filter((r) => r.enabled);
}

export { run5 };
