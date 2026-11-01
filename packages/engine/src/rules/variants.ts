import {
  PREFLOP,
  RANKS,
  SUITS,
  type GlobalCondition,
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
import { fromBlocks, type PatternBlock } from './blocks.js';

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
    '20回に1回くらい、ディーラーが札を1枚表にしてしまう。実際の手順どおり' +
    'その札は回収して引き直し、フロップのバーンに使われる（手札は公開されない）。' +
    'まれに2枚目も表にして配り直しになる。ラビットハントと手札公開も有効。',
  options: {
    exposedCardChance: 0.05,
    misdeal: true,
    rabbitHunt: true,
    showCards: 'any',
  },
};

// ============================================================
// 別のゲーム（構造・デッキを変えた定番の変種）
// ============================================================

/** 5枚オマハ。手札が5枚になり、使うのは変わらず2枚。 */
export const BIG_O: Variant = {
  ...OMAHA,
  id: 'big-o',
  name: '5枚オマハ',
  description:
    'オマハの手札を5枚にしたもの。使えるのは手札からちょうど2枚と場からちょうど3枚。' +
    '組み合わせが増えるぶん、その場で最強の手を誰かが持っていることが多くなる。',
  structure: { ...OMAHA_STRUCTURE, holeCards: 5 },
};

/** 6枚オマハ。 */
export const OMAHA_SIX: Variant = {
  ...OMAHA,
  id: 'omaha-6',
  name: '6枚オマハ',
  description:
    '手札6枚のオマハ。使えるのは手札からちょうど2枚と場からちょうど3枚。' +
    '誰もが何かしら持っている乱戦になる。',
  structure: { ...OMAHA_STRUCTURE, holeCards: 6 },
};

/**
 * マニラ。7〜A の32枚で、場は1枚ずつ5回開く。手札2枚は必ず使う。
 * 枚数が少ないのでショートデッキと同じくフラッシュがフルハウスより強い。
 * 最弱のストレートは A-7-8-9-10。
 */
const MANILA_RANKINGS = moveBefore(
  replaceFixed(
    replaceFixed(STANDARD_HAND_RANKINGS, 'steel_wheel', 'ストレートフラッシュ（A-7-8-9-10）', ['A', '7', '8', '9', '10']),
    'wheel',
    'ストレート（A-7-8-9-10）',
    ['A', '7', '8', '9', '10'],
  ),
  'flush',
  'full_house',
);

export const MANILA: Variant = {
  id: 'manila',
  name: 'マニラ',
  description:
    '7〜A の32枚。手札2枚は必ず使い、場から3枚を足す。場は1枚ずつ5回開き、そのたびに賭ける。' +
    'フラッシュがフルハウスより強く、最弱のストレートは A-7-8-9-10。',
  deck: { suits: SUITS, ranks: ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] },
  structure: {
    holeCards: 2,
    streets: [
      { name: '1枚目', cards: 1, burn: 1 },
      { name: '2枚目', cards: 1 },
      { name: '3枚目', cards: 1 },
      { name: '4枚目', cards: 1 },
      { name: '5枚目', cards: 1 },
    ],
    handSize: 5,
    holeUsage: { min: 2, max: 2 },
    boardUsage: { min: 3, max: 3 },
  },
  betting: { limit: 'pot-limit' },
  ranking: { hands: MANILA_RANKINGS },
};

/**
 * ロイヤルホールデム。10〜A の20枚。
 * 5枚同じスートは必ずロイヤルフラッシュになり、ストレートは 10-J-Q-K-A しかない。
 */
export const ROYAL_HOLDEM: Variant = {
  ...STANDARD_VARIANT,
  id: 'royal-holdem',
  name: 'ロイヤルホールデム',
  description:
    '10〜A だけの20枚。ペアもストレートも出やすく、強い手どうしの勝負になる。' +
    'ストレートは 10-J-Q-K-A だけで、5枚同じスートなら必ずロイヤルフラッシュになる（フラッシュ・ストレートフラッシュ・ハイカードは無い）。',
  deck: { suits: SUITS, ranks: ['10', 'J', 'Q', 'K', 'A'] },
  // 同じスート5枚は必ずロイヤルフラッシュ、ペアの無い5枚は必ずストレートなので、
  // ストレートフラッシュ・フラッシュ・ハイカードは出ない。7枚あれば必ず何かの役になる。
  ranking: { hands: disable(STANDARD_HAND_RANKINGS, 'straight_flush', 'steel_wheel', 'flush', 'wheel', 'high_card') },
};

/** グリーク。手札2枚と場3枚をきっかり使う。 */
export const GREEK: Variant = {
  ...STANDARD_VARIANT,
  id: 'greek',
  name: 'グリークホールデム',
  description:
    'ホールデムと同じ配り方だが、手札2枚を必ず両方使い、場からは3枚だけ使う。' +
    '場に4枚のフラッシュが出ても、手札に同じスートが2枚なければ成立しない。',
  structure: { ...HOLDEM_STRUCTURE, holeUsage: { min: 2, max: 2 }, boardUsage: { min: 3, max: 3 } },
};

/** スーパーホールデム。手札3枚を自由に使う。 */
export const SUPER_HOLDEM: Variant = {
  ...STANDARD_VARIANT,
  id: 'super-holdem',
  name: 'スーパーホールデム',
  description: '手札が3枚になり、何枚使ってもよい。ホールデムより手が強くなる。',
  structure: { ...HOLDEM_STRUCTURE, holeCards: 3 },
};

/** タホ。手札3枚のうち、使えるのは2枚まで。 */
export const TAHOE: Variant = {
  ...STANDARD_VARIANT,
  id: 'tahoe',
  name: 'タホ',
  description:
    '手札は3枚だが、役に使えるのは2枚まで（使わなくてもよい）。' +
    'オマハとホールデムの間のような感覚で、どの2枚を活かすかの読みが効く。',
  structure: { ...HOLDEM_STRUCTURE, holeCards: 3, holeUsage: { min: 0, max: 2 } },
  betting: { limit: 'pot-limit' },
};

// ============================================================
// ローカル役（調べて出てくる非標準の役）
// ============================================================

/** まとまりで書いた役。 */
const blockHand = (
  id: string,
  name: string,
  blocks: readonly PatternBlock[],
  global: readonly GlobalCondition[] = [],
): HandRanking => ({ id, name, enabled: true, pattern: fromBlocks(blocks, global) });

/** ペアなしで、上と下が決まった5枚（ドッグとキャット）。 */
const spanHand = (id: string, name: string, top: Rank, bottom: Rank, middle: readonly Rank[]): HandRanking =>
  blockHand(
    id,
    name,
    [{ kind: 'fixed', ranks: [top, bottom] }, { kind: 'oneOf', ranks: middle, count: 3 }],
    [{ type: 'allDifferentRank' }],
  );

const BIG_CAT = spanHand('big_cat', 'ビッグキャット（K〜8）', 'K', '8', ['9', '10', 'J', 'Q']);
const LITTLE_CAT = spanHand('little_cat', 'リトルキャット（8〜3）', '8', '3', ['4', '5', '6', '7']);
const BIG_DOG = spanHand('big_dog', 'ビッグドッグ（A〜9）', 'A', '9', ['10', 'J', 'Q', 'K']);
const LITTLE_DOG = spanHand('little_dog', 'リトルドッグ（7〜2）', '7', '2', ['3', '4', '5', '6']);
const SKEET = blockHand(
  'skeet',
  'スキート（2・5・9＋間の2枚）',
  [{ kind: 'fixed', ranks: ['9', '5', '2'] }, { kind: 'oneOf', ranks: ['3', '4', '6', '7', '8'], count: 2 }],
  [{ type: 'allDifferentRank' }],
);

/**
 * スキートとドッグ・キャット。どれもペアなしの5枚で、ストレートとフラッシュの間に入る。
 * 強い順にビッグキャット、リトルキャット、ビッグドッグ、リトルドッグ、スキート。
 */
export const SKEETS_AND_DOGS: Variant = {
  ...STANDARD_VARIANT,
  id: 'skeets-dogs',
  name: 'スキートとドッグ',
  description:
    'アメリカの家庭ゲームの役を5つ足す。ペアなしで上と下が決まった5枚' +
    '（ビッグキャット K〜8、リトルキャット 8〜3、ビッグドッグ A〜9、リトルドッグ 7〜2）と、' +
    '2・5・9 とその間の2枚で作るスキート。どれもストレートより強く、フラッシュより弱い。',
  ranking: {
    hands: [BIG_CAT, LITTLE_CAT, BIG_DOG, LITTLE_DOG, SKEET].reduce(
      (hands, hand) => insertBefore(hands, hand, 'straight'),
      STANDARD_HAND_RANKINGS as HandRanking[],
    ),
  },
};

/** ブレイズ。5枚すべて絵札。ツーペアより強く、スリーカードより弱い。 */
export const BLAZE: Variant = {
  ...STANDARD_VARIANT,
  id: 'blaze',
  name: 'ブレイズ',
  description:
    '5枚すべてが絵札（J・Q・K）なら「ブレイズ」。ツーペアより強く、スリーカードより弱い。' +
    '絵札は3種類しかないので、ブレイズは必ずペアを含む。',
  ranking: {
    hands: insertBefore(
      STANDARD_HAND_RANKINGS,
      blockHand('blaze', 'ブレイズ（絵札5枚）', [{ kind: 'oneOf', ranks: ['J', 'Q', 'K'], count: 5 }]),
      'three_of_a_kind',
    ),
  },
};

/** 赤と黒。色だけで揃う役を2つ足す。 */
export const RED_AND_BLACK: Variant = {
  ...STANDARD_VARIANT,
  id: 'red-black',
  name: '赤と黒',
  description:
    'スートではなく色で揃える役を足す。同じ色の連続5枚「カラーストレート」はフラッシュより強く、' +
    '同じ色の5枚「カラーフラッシュ」はワンペアより強くツーペアより弱い。',
  ranking: {
    hands: insertBefore(
      insertBefore(
        STANDARD_HAND_RANKINGS,
        blockHand('color_straight', 'カラーストレート（同じ色の連続）', [{ kind: 'run', count: 5 }], [{ type: 'allSameColor' }]),
        'flush',
      ),
      blockHand('color_flush', 'カラーフラッシュ（同じ色5枚）', [{ kind: 'any', count: 5 }], [{ type: 'allSameColor' }]),
      'one_pair',
    ),
  },
};

const FLUSH_HOUSE = blockHand(
  'flush_house',
  'フラッシュハウス',
  [{ kind: 'sameRank', count: 3 }, { kind: 'sameRank', count: 2 }],
  [{ type: 'allSameSuit' }],
);

/**
 * 3デッキ。同じ札が3枚ずつあるので、同じスートのフルハウス（同じ札3枚＋同じ札2枚）が成立する。
 * 同じ札5枚（フラッシュファイブ）は5組要るので入れない。
 */
export const TRIPLE_DECK: Variant = {
  ...STANDARD_VARIANT,
  id: 'flush-house',
  name: '3デッキ（フラッシュハウス入り）',
  description:
    '52枚を3組混ぜた156枚。同じ札が3枚ずつあるので、同じスートのフルハウス「フラッシュハウス」と、' +
    '同じランク5枚のファイブカードが成立する。強い順にフラッシュハウス、ファイブカード、ロイヤルフラッシュ。',
  deck: { suits: SUITS, ranks: RANKS, copies: 3 },
  ranking: { hands: [FLUSH_HOUSE, FIVE_OF_A_KIND, ...STANDARD_HAND_RANKINGS] },
};

/** ボブテイル。4枚で揃う役。 */
export const BOBTAIL: Variant = {
  ...STANDARD_VARIANT,
  id: 'bobtail',
  name: 'ボブテイル',
  description:
    '4枚で揃う役を足す。4枚のストレートフラッシュ「ビッグボブテイル」はフルハウスより強い。' +
    '4枚のフラッシュと4枚の連続は、ワンペアより強くツーペアより弱い。',
  ranking: {
    hands: insertBefore(
      insertBefore(
        insertBefore(
          STANDARD_HAND_RANKINGS,
          blockHand('big_bobtail', 'ビッグボブテイル（4枚のストレートフラッシュ）', [{ kind: 'run', count: 4, suit: { kind: 'same' } }]),
          'full_house',
        ),
        blockHand('four_flush', '4枚フラッシュ', [{ kind: 'any', count: 4, suit: { kind: 'same' } }]),
        'one_pair',
      ),
      blockHand('four_straight', '4枚ストレート', [{ kind: 'run', count: 4 }]),
      'one_pair',
    ),
  },
};

/** 回り込みストレート。Q-K-A-2-3 のように端をまたぐ並びを、普通のストレートの下に足す。 */
export const WRAPAROUND: Variant = {
  ...STANDARD_VARIANT,
  id: 'wraparound',
  name: '回り込みストレート',
  description:
    'K の次に A、A の次に 2 と、端をまたいで並びが続く。Q-K-A-2-3 や K-A-2-3-4 もストレートになる' +
    '（普通のストレートより弱い）。',
  ranking: {
    hands: insertBefore(
      insertBefore(
        STANDARD_HAND_RANKINGS,
        blockHand('wrap_straight', 'ストレート（回り込み）', [{ kind: 'run', count: 5, wrap: true }]),
        'three_of_a_kind',
      ),
      blockHand('wrap_straight_flush', 'ストレートフラッシュ（回り込み）', [{ kind: 'run', count: 5, wrap: true }], [{ type: 'allSameSuit' }]),
      'four_of_a_kind',
    ),
  },
};

/** 日本の家庭でよく遊ばれる形。ジョーカー1枚、ファイブカード、スートの強弱。 */
export const JAPANESE_HOME: Variant = {
  ...STANDARD_VARIANT,
  id: 'japanese-home',
  name: '日本の家庭ルール',
  description:
    'ジョーカー1枚入りの53枚で、ジョーカーは何にでも化ける。ファイブカードが最強。' +
    '同じ手ならスートで決める（スペード > ハート > ダイヤ > クラブ）。',
  deck: { suits: SUITS, ranks: RANKS, jokers: 1, suitRanking: ['spades', 'hearts', 'diamonds', 'clubs'] },
  ranking: { hands: WITH_FIVE_OF_A_KIND, wilds: [{ cards: { kind: 'joker' } }] },
};

// ============================================================
// ワイルド（ランクを指定する家庭ゲーム）
// ============================================================

/** ベースボール。野球にちなんで 3 と 9 がワイルド。 */
export const BASEBALL: Variant = {
  ...STANDARD_VARIANT,
  id: 'baseball',
  name: 'ベースボール（3と9がワイルド）',
  description:
    '野球の「3アウト」「9イニング」にちなんで、3 と 9 の8枚が何にでも化ける。' +
    'ワイルドが多いので、ファイブカードもよく出る。',
  ranking: { hands: WITH_FIVE_OF_A_KIND, wilds: [{ cards: { kind: 'rank', ranks: ['3', '9'] } }] },
};

/** ドクターペッパー。昔の広告の「10時・2時・4時」にちなむ。 */
export const DR_PEPPER: Variant = {
  ...STANDARD_VARIANT,
  id: 'dr-pepper',
  name: 'ドクターペッパー（10・2・4がワイルド）',
  description:
    '清涼飲料の昔の広告「10時・2時・4時に飲もう」にちなんで、10・2・4 の12枚が何にでも化ける。' +
    '役はかなり派手になる。',
  ranking: { hands: WITH_FIVE_OF_A_KIND, wilds: [{ cards: { kind: 'rank', ranks: ['2', '4', '10'] } }] },
};

/** ジョーカー2枚。 */
export const TWO_JOKERS: Variant = {
  ...JOKER_WILD,
  id: 'two-jokers',
  name: 'ジョーカー2枚',
  description: '54枚。2枚のジョーカーが何にでも化ける。ファイブカードが最強。',
  deck: { suits: SUITS, ranks: RANKS, jokers: 2 },
};

// ============================================================
// 賭け方・卓の作法
// ============================================================

/** ポットリミットのホールデム。 */
export const POT_LIMIT_HOLDEM: Variant = {
  ...STANDARD_VARIANT,
  id: 'pot-limit-holdem',
  name: 'ポットリミットホールデム',
  description:
    '賭けられるのはポットの額まで。一度に全部を入れることはできないので、' +
    'ノーリミットより勝負が長く続く。',
  betting: { limit: 'pot-limit' },
};

/** 3本まで走らせる卓。 */
export const RUN_IT_THRICE: Variant = {
  ...STANDARD_VARIANT,
  id: 'run-it-thrice',
  name: '3本走らせる卓',
  description:
    '全員がオールインしたら、残りの場を最大3回めくってポットを分けられる（全員の同意が要る）。' +
    '運の偏りがならされるので、大きな勝負に乗りやすい。',
  options: { runItTwice: { max: 3 }, showCards: 'any' },
};

// ============================================================
// 一覧
// ============================================================

/** 選べるバリアントの一覧。UI はこれを並べる。 */
export const VARIANT_PRESETS: readonly Variant[] = [
  // 定番
  STANDARD_VARIANT,
  OMAHA,
  FIXED_LIMIT,
  POT_LIMIT_HOLDEM,
  // 別のゲーム
  BIG_O,
  OMAHA_SIX,
  SHORT_DECK,
  MANILA,
  ROYAL_HOLDEM,
  GREEK,
  SUPER_HOLDEM,
  TAHOE,
  SIX_CARD_FLOP,
  ACE_LOW,
  // ローカル役
  FLUSH_OVER_FULL_HOUSE,
  SUIT_RANKED,
  HOUSE_HANDS,
  PRIME_RULES,
  SKEETS_AND_DOGS,
  BLAZE,
  RED_AND_BLACK,
  TRIPLE_DECK,
  BOBTAIL,
  WRAPAROUND,
  // ワイルド
  JOKER_WILD,
  TWO_JOKERS,
  JAPANESE_HOME,
  DEUCES_WILD,
  ONE_EYED_JACKS,
  BASEBALL,
  DR_PEPPER,
  // 賭け方
  STRADDLE_TABLE,
  NO_PREFLOP_ALLIN,
  // 卓の作法
  CASUAL_TABLE,
  RUN_IT_THRICE,
  CLUMSY_DEALER,
];

export function findVariant(id: string): Variant | undefined {
  return VARIANT_PRESETS.find((variant) => variant.id === id);
}

/** 有効な役を強い順に並べた一覧。ルールの説明表示に使う。 */
export function activeRankings(variant: Variant): readonly HandRanking[] {
  return variant.ranking.hands.filter((r) => r.enabled);
}
