import { describe, expect, it } from 'vitest';
import { compareHands, evaluateBest } from '../src/rules/evaluate.js';
import {
  STANDARD_HAND_RANKINGS,
  STANDARD_VARIANT,
  anyCard,
  fixedRank,
  variableRank,
} from '../src/rules/presets.js';
import { RANKS, SUITS, type HandRanking, type Variant } from '../src/types.js';
import { cards } from './helpers.js';

const withRankings = (rankings: readonly HandRanking[]): Variant => ({
  ...STANDARD_VARIANT,
  id: 'custom',
  name: 'カスタム',
  ranking: { hands: rankings },
});

/** moveId の役を beforeId の直前（＝一つ強い順位）に移す。 */
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

function evalWith(notation: string, variant: Variant) {
  const result = evaluateBest(cards(notation), variant);
  if (!result) throw new Error(`役が成立しなかった: ${notation}`);
  return result;
}

describe('役を無効化できる', () => {
  it('フラッシュを無効にすると、フラッシュの手がハイカードになる', () => {
    const noFlush = withRankings(
      STANDARD_HAND_RANKINGS.map((r) => (r.id === 'flush' ? { ...r, enabled: false } : r)),
    );
    expect(evalWith('As Ks Qs Js 9s', STANDARD_VARIANT).rankingId).toBe('flush');
    expect(evalWith('As Ks Qs Js 9s', noFlush).rankingId).toBe('high_card');
  });

  it('全部無効にすると役が成立しない', () => {
    const nothing = withRankings(STANDARD_HAND_RANKINGS.map((r) => ({ ...r, enabled: false })));
    expect(evaluateBest(cards('As Ks Qs Js Ts'), nothing)).toBeNull();
  });
});

describe('役の順位を入れ替えられる', () => {
  it('フラッシュをフルハウスより強くできる', () => {
    const swapped = withRankings(moveBefore(STANDARD_HAND_RANKINGS, 'flush', 'full_house'));

    const flush = evalWith('As Ks Qs Js 9s', swapped);
    const fullHouse = evalWith('Ah Ad Ac Kh Kd', swapped);
    expect(compareHands(flush, fullHouse)).toBeGreaterThan(0);

    // 標準ルールでは当然逆になる
    const stdFlush = evalWith('As Ks Qs Js 9s', STANDARD_VARIANT);
    const stdFullHouse = evalWith('Ah Ad Ac Kh Kd', STANDARD_VARIANT);
    expect(compareHands(stdFlush, stdFullHouse)).toBeLessThan(0);
  });

  it('入れ替えても他の役の序列は壊れない', () => {
    const swapped = withRankings(moveBefore(STANDARD_HAND_RANKINGS, 'flush', 'full_house'));
    const royal = evalWith('As Ks Qs Js Ts', swapped);
    const flush = evalWith('Ah Kh Qh Jh 9h', swapped);
    const quads = evalWith('As Ah Ad Ac Kh', swapped);
    // ロイヤルは依然として最強、フラッシュはフォーカードより下のまま
    expect(compareHands(royal, flush)).toBeGreaterThan(0);
    expect(compareHands(quads, flush)).toBeGreaterThan(0);
  });
});

describe('カードの強さを差し替えられる', () => {
  it('2 を最強のランクにすると、2 のペアが A のペアに勝つ', () => {
    const twoIsKing: Variant = {
      ...STANDARD_VARIANT,
      deck: {
        suits: SUITS,
        ranks: ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'],
      },
    };
    const pairOfTwos = evalWith('2s 2h 5c 4h 3s', twoIsKing);
    const pairOfAces = evalWith('As Ah Kc Qh Js', twoIsKing);
    expect(pairOfTwos.rankingId).toBe('one_pair');
    expect(compareHands(pairOfTwos, pairOfAces)).toBeGreaterThan(0);
  });

  it('スートに強弱を付けると、それまで引き分けだった手に差が付く', () => {
    const spadesHigh: Variant = {
      ...STANDARD_VARIANT,
      deck: { suits: SUITS, ranks: RANKS, suitRanking: ['spades', 'hearts', 'diamonds', 'clubs'] },
    };
    // ランク構成が完全に同じ2つの手
    const a = 'As Ah Kc 3h 2s';
    const b = 'Ad Ac Kd 3d 2d';
    expect(compareHands(evalWith(a, STANDARD_VARIANT), evalWith(b, STANDARD_VARIANT))).toBe(0);
    expect(compareHands(evalWith(a, spadesHigh), evalWith(b, spadesHigh))).toBeGreaterThan(0);
  });
});

describe('カスタム役を追加できる', () => {
  /** 「ペア＋連続する3枚」= X, X, Y, Y+1, Y+2 */
  const pairPlusRun: HandRanking = {
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
  const variant = withRankings([pairPlusRun, ...STANDARD_HAND_RANKINGS]);

  it('変数の相対指定で定義した役が成立する', () => {
    const result = evalWith('As Ah 5c 6h 7s', variant);
    expect(result.rankingId).toBe('pair_plus_run');
    expect(result.rankingIndex).toBe(0);
  });

  it('条件を満たさない手には成立しない', () => {
    // ペアはあるが連続3枚がない
    expect(evalWith('As Ah 5c 6h 9s', variant).rankingId).toBe('one_pair');
  });

  it('最強の順位に置いたのでロイヤルフラッシュより強い', () => {
    const custom = evalWith('As Ah 5c 6h 7s', variant);
    const royal = evalWith('As Ks Qs Js Ts', variant);
    expect(compareHands(custom, royal)).toBeGreaterThan(0);
  });

  it('異なる変数名は異なるランクを指す', () => {
    const twoDistinctPairs: HandRanking = {
      id: 'two_distinct_pairs',
      name: '相異なる2ペア',
      enabled: true,
      pattern: {
        cards: [variableRank('X'), variableRank('X'), variableRank('Y'), variableRank('Y')],
        global: [],
      },
    };
    const rs = withRankings([twoDistinctPairs, ...STANDARD_HAND_RANKINGS]);
    // 同ランク4枚は X≠Y 制約により two_distinct_pairs にならない
    expect(evalWith('As Ah Ad Ac Kh', rs).rankingId).toBe('four_of_a_kind');
    // 本物のツーペアなら成立する
    expect(evalWith('As Ah Kd Kc 2s', rs).rankingId).toBe('two_distinct_pairs');
  });

  it('スート条件付きのカスタム役を定義できる', () => {
    const spadeAcePair: HandRanking = {
      id: 'spade_ace_pair',
      name: 'スペードのAを含むペア',
      enabled: true,
      pattern: {
        cards: [
          { rank: { type: 'fixed', value: 'A' }, suits: ['spades'] },
          { rank: { type: 'fixed', value: 'A' }, suits: ['hearts', 'diamonds', 'clubs'] },
        ],
        global: [],
      },
    };
    const rs = withRankings([spadeAcePair, ...STANDARD_HAND_RANKINGS]);
    expect(evalWith('As Ah Kc 3h 2s', rs).rankingId).toBe('spade_ace_pair');
    // スペードのAを含まないAペアは成立しない
    expect(evalWith('Ad Ah Kc 3h 2s', rs).rankingId).toBe('one_pair');
  });

  it('全体条件（同一スート）を使える', () => {
    const threeSuited: HandRanking = {
      id: 'three_suited',
      name: '同一スート3枚',
      enabled: true,
      pattern: { cards: [anyCard(), anyCard(), anyCard()], global: [{ type: 'allSameSuit' }] },
    };
    const rs = withRankings([threeSuited, ...STANDARD_HAND_RANKINGS]);
    expect(evalWith('As Ks Qs 2h 3d', rs).rankingId).toBe('three_suited');
    // スペードは As と 3s の2枚だけなので成立しない
    expect(evalWith('As Kh Qd 2c 3s', rs).rankingId).toBe('high_card');
  });
});

describe('変則デッキでも動く', () => {
  it('2スートのデッキで判定できる', () => {
    const twoSuits: Variant = {
      ...STANDARD_VARIANT,
      deck: { suits: ['spades', 'hearts'], ranks: RANKS },
    };
    expect(evalWith('As Ah Ks 3s 2s', twoSuits).rankingId).toBe('one_pair');
  });

  it('ショートデッキ（6以上）でストレートが判定できる', () => {
    const short: Variant = {
      ...STANDARD_VARIANT,
      deck: { suits: SUITS, ranks: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] },
    };
    expect(evalWith('Th 9s 8d 7c 6s', short).rankingId).toBe('straight');
  });
});

describe('エンジンは標準ポーカーを一切知らない', () => {
  it('まったく独自のルールセットだけでも動作する', () => {
    const weird: Variant = {
      id: 'weird',
      name: '独自ルール',
      deck: { suits: ['spades', 'hearts'], ranks: ['A', 'K', 'Q', 'J'] },
      structure: STANDARD_VARIANT.structure,
      betting: STANDARD_VARIANT.betting,
      ranking: {
        hands: [
          {
            id: 'queen_jack',
            name: 'クイーンとジャック',
            enabled: true,
            pattern: { cards: [fixedRank('Q'), fixedRank('J')], global: [] },
          },
          {
            id: 'anything',
            name: 'なんでも',
            enabled: true,
            pattern: { cards: [anyCard()], global: [] },
          },
        ],
      },
    };
    expect(evalWith('Qs Jh As Ks Kh', weird).rankingId).toBe('queen_jack');
    // J がないので queen_jack は成立しない
    expect(evalWith('As Ks Ah Kh Qh', weird).rankingId).toBe('anything');
  });
});
