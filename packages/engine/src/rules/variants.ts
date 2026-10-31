import {
  PREFLOP,
  RANKS,
  SUITS,
  type HandRanking,
  type HandStructure,
  type Rank,
  type Variant,
} from '../types.js';
import {
  HOLDEM_STRUCTURE,
  NO_LIMIT,
  STANDARD_HAND_RANKINGS,
  STANDARD_VARIANT,
  fixedRank,
  oneOfRanks,
  variableRank,
} from './presets.js';

/**
 * バリアントのプリセット。
 *
 * どれもエンジンのコードには一行も手を入れず、Variant というデータだけで
 * 表現されている。「カスタムルール対応」が後付け機能ではなく唯一の経路で
 * あることが、ここで実際に確かめられる（→ docs/variants.md）。
 */

// ---- 役の並びを編集する小道具 ----

/** 指定した役を、別の役の直前（＝一つ強い順位）へ移す。 */
export function moveBefore(
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
export function disable(
  rankings: readonly HandRanking[],
  ...ids: readonly string[]
): HandRanking[] {
  const targets = new Set(ids);
  return rankings.map((r) => (targets.has(r.id) ? { ...r, enabled: false } : r));
}

/** 役を指定した役の直前に差し込む。 */
export function insertBefore(
  rankings: readonly HandRanking[],
  ranking: HandRanking,
  beforeId: string,
): HandRanking[] {
  const at = rankings.findIndex((r) => r.id === beforeId);
  if (at < 0) throw new Error(`役が見つからない: ${beforeId}`);
  return [...rankings.slice(0, at), ranking, ...rankings.slice(at)];
}

/** 指定した役のカード条件を固定ランクで差し替える。 */
function replaceFixed(
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

// ============================================================
// 構造を変える変種
// ============================================================

/** オマハ。手札4枚から**ちょうど2枚**、場から**ちょうど3枚**で役を作る。 */
const OMAHA_STRUCTURE: HandStructure = {
  ...HOLDEM_STRUCTURE,
  holeCards: 4,
  holeUsage: { min: 2, max: 2 },
  boardUsage: { min: 3, max: 3 },
};

export const OMAHA: Variant = {
  id: 'omaha',
  name: 'オマハ（ポットリミット）',
  description:
    '手札が4枚になるが、役に使えるのは手札からちょうど2枚と場からちょうど3枚。' +
    '手札が多いぶん強い役が出やすく、「使えない2枚」の読みが効く。' +
    '賭けはポットの額まで——実際のオマハもほぼこの形で行われる。',
  deck: { suits: SUITS, ranks: RANKS },
  structure: OMAHA_STRUCTURE,
  // ノーリミットだと手札4枚の強さに賭けが追いつかず、毎回オールインになる。
  betting: { limit: 'pot-limit' },
  ranking: { hands: STANDARD_HAND_RANKINGS },
};

/**
 * リミットホールデム。賭け額が刻みで決まっている。
 *
 * 1回に動く額が小さいので、オールインの応酬ではなく積み重ねの勝負になる。
 * ターンから額が倍になるのが昔ながらの形。
 */
export const FIXED_LIMIT: Variant = {
  ...STANDARD_VARIANT,
  id: 'fixed-limit',
  name: 'リミットホールデム',
  description:
    '賭け額が刻みで決まっていて、ターンから倍になる。1ラウンドのレイズは4回まで。' +
    '一度に大きく動かせないぶん、降り際の判断が効いてくる。',
  betting: { limit: 'fixed-limit', bigBetFrom: 1, maxRaisesPerRound: 4 },
};

/**
 * ストラドルあり。
 *
 * BB の左隣が自主的に倍の賭け金を出す。**出した人が最後に行動する**ので、
 * 順番そのものが変わる。額が倍になるのはその結果にすぎない。
 */
export const STRADDLE_TABLE: Variant = {
  ...STANDARD_VARIANT,
  id: 'straddle',
  name: 'ストラドルあり',
  description:
    'BB の左隣が、カードを見ずに倍の賭け金を出せる。出した人がプリフロップで' +
    '最後に行動する。2回まで重ねられる。',
  betting: { limit: 'no-limit', straddle: { max: 2 } },
};

/**
 * プリフロップでオールイン禁止。
 *
 * 配られた瞬間に全部入れる勝負を避けたい卓向け。**縛るのはレイズだけ**で、
 * コールは縛らない——縛ると相手のベットに応じられない人が出て勝負が進まない。
 */
export const NO_PREFLOP_ALLIN: Variant = {
  ...STANDARD_VARIANT,
  id: 'no-preflop-allin',
  name: 'プリフロップはオールイン禁止',
  description:
    'プリフロップでは手持ちを全部は出せない（最低1枚は残す）。フロップを見るまで' +
    '勝負が終わらないので、カードが開く回数が増える。',
  betting: { limit: 'no-limit', streetCaps: [{ street: PREFLOP, noAllIn: true }] },
};

/** フロップが6枚開く。場が広いぶん強い役が出やすい。 */
export const SIX_CARD_FLOP: Variant = {
  id: 'six-card-flop',
  name: 'フロップ6枚',
  description:
    'フロップで6枚開く。場が8枚になるので、強い役が頻繁に出て降りづらくなる。',
  deck: { suits: SUITS, ranks: RANKS },
  structure: {
    holeCards: 2,
    streets: [
      { name: 'フロップ', cards: 6, burn: 1 },
      { name: 'ターン', cards: 1, burn: 1 },
      { name: 'リバー', cards: 1, burn: 1 },
    ],
    handSize: 5,
  },
  betting: NO_LIMIT,
  ranking: { hands: STANDARD_HAND_RANKINGS },
};

// ============================================================
// デッキを変える変種
// ============================================================

/**
 * ショートデッキ（6+ホールデム）。
 *
 * 6未満を抜いた36枚。枚数が減るとフラッシュが出にくくなり、フルハウスのほうが
 * 出やすくなるので **フラッシュがフルハウスより強い**。最弱のストレートも
 * A-2-3-4-5 ではなく A-6-7-8-9 になる。
 */
const SHORT_DECK_RANKINGS = moveBefore(
  replaceFixed(
    replaceFixed(
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

export const SHORT_DECK: Variant = {
  id: 'short-deck',
  name: 'ショートデッキ（6+）',
  description:
    '2〜5を抜いた36枚。フラッシュが出にくくなるのでフルハウスより強く、最弱のストレートは A-6-7-8-9。',
  deck: { suits: SUITS, ranks: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] },
  structure: HOLDEM_STRUCTURE,
  betting: NO_LIMIT,
  ranking: { hands: SHORT_DECK_RANKINGS },
};

/**
 * エースが最弱。
 *
 * A-2-3-4-5 が普通のストレートになり、一番強いストレートは 9-10-J-Q-K。
 * 強さの並びとは別に、連続の順（sequence）でも A を 1 として数える。
 * 10-J-Q-K-A はもう連続していないので、ロイヤルフラッシュと A-2-3-4-5 の
 * 特例役はどちらも無効にする。役のパターンは書き換えなくてよい。
 */
export const ACE_LOW: Variant = {
  ...STANDARD_VARIANT,
  id: 'ace-low',
  name: 'エースが最弱',
  description:
    'A が一番弱い札になる。A-2-3-4-5 が普通のストレートになり、最強のストレートは 9-10-J-Q-K。',
  deck: {
    suits: SUITS,
    ranks: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
    sequence: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
  },
  ranking: {
    hands: disable(STANDARD_HAND_RANKINGS, 'royal_flush', 'steel_wheel', 'wheel'),
  },
};

/** スートに強弱をつける。同じ役・同じランクでも必ず決着がつく。 */
export const SUIT_RANKED: Variant = {
  ...STANDARD_VARIANT,
  id: 'suit-ranked',
  name: 'スートに強弱あり',
  description: 'スペード > ハート > ダイヤ > クラブ。引き分けのチョップが起きなくなる。',
  deck: {
    suits: SUITS,
    ranks: RANKS,
    suitRanking: ['spades', 'hearts', 'diamonds', 'clubs'],
  },
};

// ============================================================
// 役を変える変種
// ============================================================

/** フラッシュがフルハウスより強い。順位の入れ替えだけで成立する。 */
export const FLUSH_OVER_FULL_HOUSE: Variant = {
  ...STANDARD_VARIANT,
  id: 'flush-over-boat',
  name: 'フラッシュ > フルハウス',
  description: '52枚のまま、フラッシュだけをフルハウスより強くする。',
  ranking: { hands: moveBefore(STANDARD_HAND_RANKINGS, 'flush', 'full_house') },
};

/** 連続する3枚。ワンペアより強い。 */
const MINI_STRAIGHT: HandRanking = {
  id: 'mini_straight',
  name: 'ミニストレート（3枚連続）',
  enabled: true,
  pattern: {
    cards: [variableRank('X'), variableRank('X', 1), variableRank('X', 2)],
    global: [],
  },
};

/** ペアと連続3枚。ツーペアより強い。 */
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

export const HOUSE_HANDS: Variant = {
  ...STANDARD_VARIANT,
  id: 'house-hands',
  name: '独自役入り（ミニストレート・ペア＋三連）',
  description:
    '標準の役に2つ足す。3枚連続（ワンペアより上）と、ペア＋連続3枚（ツーペアより上）。',
  ranking: {
    hands: insertBefore(
      insertBefore(STANDARD_HAND_RANKINGS, PAIR_PLUS_RUN, 'two_pair'),
      MINI_STRAIGHT,
      'one_pair',
    ),
  },
};

/**
 * 素数ストレート。
 *
 * ランクを数と見て、素数（2,3,5,7,11=J,13=K）だけで5枚揃える。
 * 「いずれかのランク」を表す oneOf があると、こういう役が書ける。
 */
const PRIME_HAND: HandRanking = {
  id: 'prime',
  name: '素数ストレート（2,3,5,7,J,K)',
  enabled: true,
  pattern: {
    cards: [
      oneOfRanks('2', '3', '5', '7', 'J', 'K'),
      oneOfRanks('2', '3', '5', '7', 'J', 'K'),
      oneOfRanks('2', '3', '5', '7', 'J', 'K'),
      oneOfRanks('2', '3', '5', '7', 'J', 'K'),
      oneOfRanks('2', '3', '5', '7', 'J', 'K'),
    ],
    global: [{ type: 'allDifferentRank' }],
  },
};

export const PRIME_RULES: Variant = {
  ...STANDARD_VARIANT,
  id: 'prime',
  name: '素数ストレートあり',
  description:
    'ランクを数と見て、素数（2,3,5,7,J=11,K=13）だけで5枚揃うと成立する役を足す。フラッシュより強い。',
  ranking: { hands: insertBefore(STANDARD_HAND_RANKINGS, PRIME_HAND, 'flush') },
};

// ============================================================
// ワイルドカード
// ============================================================

/**
 * ファイブカード。
 *
 * 通常のデッキでは成立しないが、ワイルドがあると起きる。
 * ストレートフラッシュより強い（同じランク5枚のほうが揃いにくい）。
 */
const FIVE_OF_A_KIND: HandRanking = {
  id: 'five_of_a_kind',
  name: 'ファイブカード',
  enabled: true,
  pattern: {
    cards: [
      variableRank('X'),
      variableRank('X'),
      variableRank('X'),
      variableRank('X'),
      variableRank('X'),
    ],
    global: [],
  },
};

/** ワイルドを入れるなら、ファイブカードを最強の役として足す必要がある。 */
const WITH_FIVE_OF_A_KIND = [FIVE_OF_A_KIND, ...STANDARD_HAND_RANKINGS];

/** ジョーカー1枚入り。何にでも化ける。 */
export const JOKER_WILD: Variant = {
  ...STANDARD_VARIANT,
  id: 'joker-wild',
  name: 'ジョーカー1枚',
  description:
    '53枚。ジョーカーは何にでも化ける。同じランク5枚（ファイブカード）が' +
    '成立するようになり、ストレートフラッシュより強い。',
  deck: { suits: SUITS, ranks: RANKS, jokers: 1 },
  ranking: {
    hands: WITH_FIVE_OF_A_KIND,
    wilds: [{ cards: { kind: 'joker' } }],
  },
};

/** 2がワイルド。4枚もワイルドがあるので役がかなり派手になる。 */
export const DEUCES_WILD: Variant = {
  ...STANDARD_VARIANT,
  id: 'deuces-wild',
  name: '2がワイルド',
  description:
    '4枚ある2がすべて何にでも化ける。役が派手になり、ツーペア程度では勝てなくなる。',
  deck: { suits: SUITS, ranks: RANKS },
  ranking: {
    hands: WITH_FIVE_OF_A_KIND,
    wilds: [{ cards: { kind: 'rank', ranks: ['2'] } }],
  },
};

/**
 * 片目のジャック（J♠ と J♥）だけがワイルド。
 *
 * 実在のハウスルール。絵柄が横を向いていて片目に見えるジャックが対象。
 * 「特定のカードだけワイルド」が書けることの見本でもある。
 */
export const ONE_EYED_JACKS: Variant = {
  ...STANDARD_VARIANT,
  id: 'one-eyed-jacks',
  name: '片目のジャック',
  description:
    'スペードとハートのJだけが何にでも化ける。実在のハウスルール。' +
    'ワイルドが2枚しかないので、派手さと読みやすさのバランスが取れている。',
  deck: { suits: SUITS, ranks: RANKS },
  ranking: {
    hands: WITH_FIVE_OF_A_KIND,
    wilds: [
      {
        cards: {
          kind: 'card',
          cards: [
            { rank: 'J', suit: 'spades' },
            { rank: 'J', suit: 'hearts' },
          ],
        },
      },
    ],
  },
};

// ============================================================
// 卓の作法を変える変種
// ============================================================

/** 流れた後に続きを見られて、降りた手も見せられる気楽な卓。 */
export const CASUAL_TABLE: Variant = {
  ...STANDARD_VARIANT,
  id: 'casual',
  name: 'カジュアル卓',
  description:
    '勝負が流れたら「続きどうなってた？」を見られる（ラビットハント）。' +
    'オールインで決着するときは2本走らせられる。' +
    '決着後や降りた後に手札を1枚だけ見せることもできる。',
  options: { rabbitHunt: true, showCards: 'one', runItTwice: { max: 2 } },
};

/**
 * ディーラーが札を表にしてしまう卓。
 *
 * 実際の手順どおりに扱う。1枚なら回収して引き直し（ミスディールではない）、
 * その札はフロップのバーンに使う。2枚以上なら配り直し。
 */
export const CLUMSY_DEALER: Variant = {
  ...STANDARD_VARIANT,
  id: 'clumsy-dealer',
  name: 'ディーラーが不器用',
  description:
    '4回に1回くらい、ディーラーが札を1枚表にしてしまう。実際の手順どおり' +
    'その札は回収して引き直し、フロップのバーンに使われる（手札は公開されない）。' +
    'まれに2枚以上で配り直しになる。ラビットハントと手札公開も有効。',
  options: {
    exposedCardChance: 0.25,
    misdealChance: 0.05,
    rabbitHunt: true,
    showCards: 'any',
  },
};

// ============================================================
// 一覧
// ============================================================

/** 選べるバリアントの一覧。UI はこれを並べる。 */
export const VARIANT_PRESETS: readonly Variant[] = [
  STANDARD_VARIANT,
  OMAHA,
  SHORT_DECK,
  SIX_CARD_FLOP,
  FLUSH_OVER_FULL_HOUSE,
  ACE_LOW,
  SUIT_RANKED,
  HOUSE_HANDS,
  PRIME_RULES,
  JOKER_WILD,
  DEUCES_WILD,
  ONE_EYED_JACKS,
  FIXED_LIMIT,
  STRADDLE_TABLE,
  NO_PREFLOP_ALLIN,
  CASUAL_TABLE,
  CLUMSY_DEALER,
];

export function findVariant(id: string): Variant | undefined {
  return VARIANT_PRESETS.find((variant) => variant.id === id);
}

/** 有効な役を強い順に並べた一覧。ルールの説明表示に使う。 */
export function activeRankings(variant: Variant): readonly HandRanking[] {
  return variant.ranking.hands.filter((r) => r.enabled);
}
