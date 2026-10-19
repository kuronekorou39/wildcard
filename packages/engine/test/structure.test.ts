import { describe, expect, it } from 'vitest';
import { MAX_DECK_SIZE, buildDeck, deckSize } from '../src/deck.js';
import { createGame, reduce } from '../src/game/reduce.js';
import { evaluateBest, evaluateHand } from '../src/rules/evaluate.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { OMAHA, SIX_CARD_FLOP } from '../src/rules/variants.js';
import {
  boardSize,
  boardUsageOf,
  holeUsageOf,
  maxPlayersFor,
  requiredCards,
  streetName,
  validateVariant,
} from '../src/variant.js';
import { PREFLOP, SUITS, RANKS, type Action, type GameState, type Variant } from '../src/types.js';
import { cards } from './helpers.js';

const run = (state: GameState, actions: readonly Action[]) => actions.reduce(reduce, state);

function tableOf(count: number, variant: Variant, chips = 1000): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
  for (let i = 0; i < count; i++) {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips });
  }
  return state;
}

/** 全員がチェック/コールで次のストリートへ進める。 */
function callAround(state: GameState): GameState {
  let current = state;
  let guard = 0;
  const street = current.streetIndex;
  while (current.phase === 'betting' && current.streetIndex === street && guard++ < 30) {
    const id = current.turnPlayerId!;
    const needs = current.currentBet > current.players.find((p) => p.id === id)!.bet;
    current = reduce(current, needs ? { type: 'call', playerId: id } : { type: 'check', playerId: id });
  }
  return current;
}

// ============================================================
// デッキの組み方
// ============================================================

describe('デッキはカード単位まで指定できる', () => {
  it('直積が土台', () => {
    expect(buildDeck({ suits: SUITS, ranks: RANKS })).toHaveLength(52);
  });

  it('スートを外すとそのスートが丸ごと消える', () => {
    const deck = buildDeck({ suits: ['spades', 'hearts', 'diamonds'], ranks: RANKS });
    expect(deck).toHaveLength(39);
    expect(deck.some((c) => c.suit === 'clubs')).toBe(false);
  });

  it('copies で全体を複数組にできる', () => {
    expect(buildDeck({ suits: SUITS, ranks: RANKS, copies: 2 })).toHaveLength(104);
  });

  it('特定のカードだけ枚数を増やせる', () => {
    const deck = buildDeck({
      suits: SUITS,
      ranks: RANKS,
      overrides: [{ rank: 'A', suit: 'spades', count: 10 }],
    });
    // 直積52枚のうち A♠ 1枚が10枚に置き換わる
    expect(deck).toHaveLength(52 - 1 + 10);
    expect(deck.filter((c) => c.rank === 'A' && c.suit === 'spades')).toHaveLength(10);
  });

  it('特定のカードだけ抜ける', () => {
    const deck = buildDeck({
      suits: SUITS,
      ranks: RANKS,
      overrides: [{ rank: 'K', suit: 'hearts', count: 0 }],
    });
    expect(deck).toHaveLength(51);
    expect(deck.some((c) => c.rank === 'K' && c.suit === 'hearts')).toBe(false);
  });

  it('suits に無いスートも overrides で足せる', () => {
    const deck = buildDeck({
      suits: ['spades'],
      ranks: RANKS,
      overrides: [{ rank: 'A', suit: 'hearts', count: 1 }],
    });
    expect(deck).toHaveLength(14);
    expect(deck.filter((c) => c.suit === 'hearts')).toHaveLength(1);
  });
});

// ============================================================
// バーンカード
// ============================================================

describe('バーンカード', () => {
  it('必要枚数の計算に入る', () => {
    // 手札2枚×3人 ＋ 場5枚 ＋ バーン3枚
    expect(requiredCards(STANDARD_VARIANT.structure, 3)).toBe(6 + 5 + 3);
  });

  it('場を開くたびに山札から落ちる', () => {
    let state = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 1 });
    expect(state.deck).toHaveLength(52 - 6);
    expect(state.burned).toHaveLength(0);

    state = callAround(state);
    expect(state.streetIndex).toBe(0);
    // フロップ: バーン1枚 + 3枚
    expect(state.communityCards).toHaveLength(3);
    expect(state.burned).toHaveLength(1);
    expect(state.deck).toHaveLength(52 - 6 - 4);
  });

  it('リバーまでで3枚焼かれる', () => {
    let state = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 1 });
    for (let i = 0; i < 4; i++) state = callAround(state);
    expect(state.phase).toBe('showdown');
    expect(state.burned).toHaveLength(3);
    expect(state.communityCards).toHaveLength(5);
  });

  it('焼いたカードは場に出ない', () => {
    let state = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 5 });
    for (let i = 0; i < 4; i++) state = callAround(state);
    const board = new Set(state.communityCards.map((c) => `${c.rank}${c.suit}`));
    for (const burnt of state.burned) {
      expect(board.has(`${burnt.rank}${burnt.suit}`)).toBe(false);
    }
  });
});

// ============================================================
// 検算
// ============================================================

describe('バリアントの検算', () => {
  it('標準のバリアントは問題なし', () => {
    for (const players of [2, 6, 10]) {
      expect(validateVariant(STANDARD_VARIANT, players)).toEqual([]);
    }
  });

  it('デッキが足りなければ指摘される', () => {
    // 手札4枚のオマハを 2スート（26枚）で10人は無理
    const tooSmall: Variant = {
      ...OMAHA,
      deck: { suits: ['spades', 'hearts'], ranks: RANKS },
    };
    const problems = validateVariant(tooSmall, 10);
    expect(problems.some((p) => p.field === 'deck')).toBe(true);
    expect(problems[0]!.message).toContain('枚必要');
  });

  it('手札より多く使う指定は弾かれる', () => {
    const broken: Variant = {
      ...STANDARD_VARIANT,
      structure: { ...STANDARD_VARIANT.structure, holeUsage: { min: 0, max: 3 } },
    };
    expect(validateVariant(broken, 2).some((p) => p.field === 'structure.holeUsage')).toBe(true);
  });

  it('役を組めない組み合わせは弾かれる', () => {
    const broken: Variant = {
      ...STANDARD_VARIANT,
      structure: {
        ...STANDARD_VARIANT.structure,
        holeUsage: { min: 0, max: 1 },
        boardUsage: { min: 0, max: 2 },
      },
    };
    expect(validateVariant(broken, 2).some((p) => p.field === 'structure.handSize')).toBe(true);
  });

  it('ranks に無いランクを overrides で足そうとすると弾かれる', () => {
    const broken: Variant = {
      ...STANDARD_VARIANT,
      deck: {
        suits: SUITS,
        ranks: ['K', 'A'],
        overrides: [{ rank: '2', suit: 'spades', count: 4 }],
      },
    };
    expect(validateVariant(broken, 2).some((p) => p.field === 'deck.overrides')).toBe(true);
  });

  it('有効な役が無ければ弾かれる', () => {
    const broken: Variant = {
      ...STANDARD_VARIANT,
      ranking: { hands: STANDARD_VARIANT.ranking.hands.map((h) => ({ ...h, enabled: false })) },
    };
    expect(validateVariant(broken, 2).some((p) => p.field === 'ranking.hands')).toBe(true);
  });

  it('何人まで座れるかを計算できる', () => {
    // 52 - (場5 + バーン3) = 44 枚を手札2枚ずつで割る
    expect(maxPlayersFor(STANDARD_VARIANT)).toBe(22);
    // オマハは手札4枚なので半分
    expect(maxPlayersFor(OMAHA)).toBe(11);
  });

  it('山札が足りないハンドは開始時に弾かれる', () => {
    const tiny: Variant = {
      ...STANDARD_VARIANT,
      deck: { suits: ['spades'], ranks: ['J', 'Q', 'K', 'A'] }, // 4枚
    };
    const state = tableOf(3, tiny);
    const rejection = reduce(state, { type: 'startHand', seed: 1 });
    expect(rejection).toBe(state); // 何も起きない
  });
});

// ============================================================
// オマハ — 使用枚数の制約
// ============================================================

describe('オマハ', () => {
  it('手札が4枚配られる', () => {
    const state = reduce(tableOf(3, OMAHA), { type: 'startHand', seed: 1 });
    for (const p of state.players) expect(p.holeCards).toHaveLength(4);
    expect(state.deck).toHaveLength(52 - 12);
  });

  it('使用枚数はちょうど手札2枚＋場3枚', () => {
    expect(holeUsageOf(OMAHA.structure)).toEqual({ min: 2, max: 2 });
    expect(boardUsageOf(OMAHA.structure)).toEqual({ min: 3, max: 3 });
  });

  it('場の5枚をそのまま使うことはできない', () => {
    // 場にロイヤルフラッシュが完成している。ホールデムなら「場を使う」で成立するが、
    // オマハは場から3枚までなので成立しない。
    const hole = cards('2h 3d 4c 5h');
    const board = cards('As Ks Qs Js Ts');

    expect(evaluateBest([...hole, ...board], STANDARD_VARIANT)!.rankingId).toBe('royal_flush');
    expect(evaluateHand(hole, board, OMAHA)!.rankingId).not.toBe('royal_flush');
  });

  it('手札2枚と場3枚で揃えば成立する', () => {
    const hole = cards('As Ks 2h 3d');
    const board = cards('Qs Js Ts 7h 4c');
    expect(evaluateHand(hole, board, OMAHA)!.rankingId).toBe('royal_flush');
  });

  it('手札に1枚しか無いスートでフラッシュは作れない', () => {
    // ホールデムなら手札1枚＋場4枚でフラッシュになるが、オマハは手札2枚必須。
    // A K Q J 9 のスペードなので、ロイヤルではなく普通のフラッシュ。
    const hole = cards('As 2h 3d 4c');
    const board = cards('Ks Qs Js 9s 5h');

    expect(evaluateBest([...hole, ...board], STANDARD_VARIANT)!.rankingId).toBe('flush');
    const omaha = evaluateHand(hole, board, OMAHA)!;
    expect(omaha.rankingId).not.toBe('flush');
  });

  it('使った札はちょうど5枚', () => {
    const hole = cards('As Ks 2h 3d');
    const board = cards('Qs Js Ts 7h 4c');
    expect(evaluateHand(hole, board, OMAHA)!.cards).toHaveLength(5);
  });

  it('ハンドが決着まで進む', () => {
    let state = reduce(tableOf(3, OMAHA), { type: 'startHand', seed: 11 });
    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.phase).toBe('showdown');
    expect(state.summary!.revealed).toHaveLength(3);
  });

  it('チップの総量が変わらない', () => {
    const start = tableOf(4, OMAHA);
    const before = start.players.reduce((s, p) => s + p.chips, 0);
    let state = reduce(start, { type: 'startHand', seed: 3 });
    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.players.reduce((s, p) => s + p.chips, 0) + state.pot).toBe(before);
  });
});

// ============================================================
// ストリートの一般化
// ============================================================

describe('ストリートは枚数も数も自由', () => {
  it('フロップ6枚のバリアントでは場が8枚になる', () => {
    expect(boardSize(SIX_CARD_FLOP.structure)).toBe(8);

    let state = reduce(tableOf(3, SIX_CARD_FLOP), { type: 'startHand', seed: 2 });
    state = callAround(state);
    expect(state.communityCards).toHaveLength(6);

    for (let i = 0; i < 3 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.phase).toBe('showdown');
    expect(state.communityCards).toHaveLength(8);
  });

  it('ストリートの名前はバリアントが持つ', () => {
    expect(streetName(STANDARD_VARIANT, PREFLOP)).toBe('プリフロップ');
    expect(streetName(STANDARD_VARIANT, 0)).toBe('フロップ');
    expect(streetName(STANDARD_VARIANT, 2)).toBe('リバー');
    expect(streetName(SIX_CARD_FLOP, 0)).toBe('フロップ');
  });

  it('カードを開かないベッティングラウンドも作れる', () => {
    const extraRound: Variant = {
      ...STANDARD_VARIANT,
      id: 'extra-round',
      structure: {
        ...STANDARD_VARIANT.structure,
        streets: [
          { name: '様子見', cards: 0 },
          { name: 'フロップ', cards: 3, burn: 1 },
          { name: 'ターン', cards: 1, burn: 1 },
          { name: 'リバー', cards: 1, burn: 1 },
        ],
      },
    };
    expect(validateVariant(extraRound, 3)).toEqual([]);

    let state = reduce(tableOf(3, extraRound), { type: 'startHand', seed: 4 });
    state = callAround(state);
    expect(state.streetIndex).toBe(0);
    expect(state.communityCards).toHaveLength(0); // 開かないラウンド
    expect(state.phase).toBe('betting');

    state = callAround(state);
    expect(state.communityCards).toHaveLength(3);
  });

  it('ストリートが無ければ配った直後にショーダウン', () => {
    const noBoard: Variant = {
      ...STANDARD_VARIANT,
      id: 'no-board',
      structure: {
        holeCards: 5,
        streets: [],
        handSize: 5,
        holeUsage: { min: 5, max: 5 },
        boardUsage: { min: 0, max: 0 },
      },
    };
    expect(validateVariant(noBoard, 3)).toEqual([]);

    let state = reduce(tableOf(3, noBoard), { type: 'startHand', seed: 6 });
    expect(state.players[0]!.holeCards).toHaveLength(5);

    state = callAround(state);
    expect(state.phase).toBe('showdown');
    expect(state.summary!.revealed).toHaveLength(3);
  });
});


describe('デッキが大きすぎるとき', () => {
  const huge: Variant = {
    ...STANDARD_VARIANT,
    deck: { ...STANDARD_VARIANT.deck, copies: 1000 },
  };

  it('枚数を数えるだけなら札を作らない', () => {
    // buildDeck を呼ぶと 52,000 枚を確保しに行く。数えるだけなら要らない。
    expect(deckSize(huge.deck)).toBe(52000);
  });

  it('検算で弾く', () => {
    const problems = validateVariant(huge, 2);
    expect(problems.some((p) => p.field === 'deck' && p.message.includes('大きすぎる'))).toBe(true);
  });

  it('buildDeck は黙って切り詰めず、はっきり失敗する', () => {
    // 切り詰めると、配った札が設定と食い違ったまま対局が進む。
    expect(() => buildDeck(huge.deck)).toThrow(/大きすぎる/);
  });

  it('上限ちょうどは作れる', () => {
    const ok = { suits: ['spades'] as const, ranks: ['2'] as const, copies: MAX_DECK_SIZE };
    expect(buildDeck(ok)).toHaveLength(MAX_DECK_SIZE);
  });
});
