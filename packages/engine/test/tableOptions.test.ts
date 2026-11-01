import { describe, expect, it } from 'vitest';
import { createGame, reduce, validate } from '../src/game/reduce.js';
import { project } from '../src/game/project.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { extraCardsFor, rabbitCards } from '../src/variant.js';
import { parseVariant, variantToJson } from '../src/rules/parse.js';
import type { Action, GameState, TableOptions, Variant } from '../src/types.js';

function withOptions(options: TableOptions): Variant {
  return { ...STANDARD_VARIANT, id: 'opt', options };
}

function tableOf(count: number, variant: Variant): GameState {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, variant });
  for (let i = 0; i < count; i++) {
    state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips: 1000 });
  }
  return state;
}

const run = (state: GameState, actions: readonly Action[]) => actions.reduce(reduce, state);

/** 決着まで順に降りる。手番は1手ごとに動くので、毎回 state から読み直す。 */
function foldDown(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (current.phase === 'betting' && guard++ < 20) {
    current = reduce(current, { type: 'fold', playerId: current.turnPlayerId! });
  }
  return current;
}

/** 全員がチェック/コールで1ラウンド進める。 */
function callAround(state: GameState): GameState {
  let current = state;
  const street = current.streetIndex;
  let guard = 0;
  while (current.phase === 'betting' && current.streetIndex === street && guard++ < 30) {
    const id = current.turnPlayerId!;
    const needs = current.currentBet > current.players.find((p) => p.id === id)!.bet;
    current = reduce(current, needs ? { type: 'call', playerId: id } : { type: 'check', playerId: id });
  }
  return current;
}

// ============================================================
// ディーラーが札を表にしてしまったとき
// ============================================================

const exposedCount = (state: GameState) => state.exposedCards.length;

/** 卓に出ている全員のホールカードを、そのプレイヤー以外の視点から数える。 */
function visibleToOthers(state: GameState, ownerId: string): number {
  const other = state.players.find((p) => p.id !== ownerId)!;
  const seen = project(state, other.id).players.find((p) => p.id === ownerId)!;
  return seen.holeCards.filter((c) => c !== null).length;
}

describe('札を1枚表にしてしまったとき（ミスディールではない）', () => {
  it('既定では起きない', () => {
    for (let seed = 0; seed < 30; seed++) {
      const state = reduce(tableOf(4, STANDARD_VARIANT), { type: 'startHand', seed });
      expect(exposedCount(state), `seed=${seed}`).toBe(0);
    }
  });

  it('確率1なら必ず1枚だけ表になる', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    for (let seed = 0; seed < 20; seed++) {
      const state = reduce(tableOf(4, variant), { type: 'startHand', seed });
      expect(exposedCount(state), `seed=${seed}`).toBe(1);
    }
  });

  it('表になった札は回収され、誰の手札にも無い', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    const state = reduce(tableOf(4, variant), { type: 'startHand', seed: 1 });
    const exposed = state.exposedCards[0]!;
    const key = (c: { rank: string; suit: string }) => `${c.rank}${c.suit}`;

    const inHands = state.players.flatMap((p) => p.holeCards).map(key);
    expect(inHands).not.toContain(key(exposed));
  });

  it('全員の手札は枚数が揃っている（引き直されている）', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    const state = reduce(tableOf(4, variant), { type: 'startHand', seed: 1 });
    for (const p of state.players) {
      expect(p.holeCards, `${p.id}`).toHaveLength(2);
    }
  });

  it('**本人の手札は公開されない**', () => {
    // 回収して引き直すので、手札が割れるわけではない。
    // 全員が知るのは「その札はもう出ない」という情報だけ。
    const variant = withOptions({ exposedCardChance: 1 });
    const state = reduce(tableOf(3, variant), { type: 'startHand', seed: 1 });

    for (const p of state.players) {
      expect(p.exposedHoleCards, `${p.id}`).toEqual([]);
      expect(visibleToOthers(state, p.id), `${p.id} の手札が他人に見えている`).toBe(0);
    }
  });

  it('表になった札は全員に見える', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    const state = reduce(tableOf(3, variant), { type: 'startHand', seed: 1 });
    // project しても消えない（誰の手札でもないので伏せる理由がない）
    for (const viewer of [null, 'p0', 'p1']) {
      expect(project(state, viewer).exposedCards).toEqual(state.exposedCards);
    }
  });

  it('その札はフロップのバーンに使われ、山札の消費は変わらない', () => {
    // 引き直しで1枚多く引くが、そのぶんフロップのバーンを山札から取らない。
    // だからデッキの検算が狂わない。
    const plain = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 1 });
    const exposedVariant = withOptions({ exposedCardChance: 1 });
    const exposed = reduce(tableOf(3, exposedVariant), { type: 'startHand', seed: 1 });

    // 配った直後は、引き直したぶん1枚少ない
    expect(exposed.deck).toHaveLength(plain.deck.length - 1);

    // フロップまで進めると追いつく
    const afterPlain = callAround(plain);
    const afterExposed = callAround(exposed);
    expect(afterExposed.deck).toHaveLength(afterPlain.deck.length);
    expect(afterExposed.communityCards).toHaveLength(3);
  });

  it('**露出が起きても場に出る札は変わらない**', () => {
    // この手順の肝。引き直しに使う「山札の top」は、本来バーンになるはずだった札。
    // だから露出した札がバーンの席に収まり、フロップ以降は丸ごと同じになる。
    // ディーラーのミスで場が変わってしまわないよう、そう組まれている。
    const plain = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 9 });
    const exposed = reduce(tableOf(3, withOptions({ exposedCardChance: 1 })), {
      type: 'startHand',
      seed: 9,
    });

    let a = plain;
    let b = exposed;
    for (let i = 0; i < 4; i++) {
      a = callAround(a);
      b = callAround(b);
    }

    expect(b.communityCards).toEqual(a.communityCards);
  });

  it('別途焼く設定にすると、場に出る札がずれる', () => {
    // ハウスによっては「露出した札は捨てて、バーンは通常どおり山札から取る」
    // 運用もありうる。その場合は1枚余分に消えるので、場に出る札がずれる。
    const plain = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 9 });
    const separate = reduce(
      tableOf(3, withOptions({ exposedCardChance: 1, exposedCardBecomesBurn: false })),
      { type: 'startHand', seed: 9 },
    );

    let a = plain;
    let b = separate;
    for (let i = 0; i < 4; i++) {
      a = callAround(a);
      b = callAround(b);
    }

    expect(b.communityCards).not.toEqual(a.communityCards);
    // 1枚余分に消えている
    expect(b.deck.length).toBe(a.deck.length - 1);
  });

  it('別途焼く設定でも、表になった札は場に出ない', () => {
    const variant = withOptions({ exposedCardChance: 1, exposedCardBecomesBurn: false });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 4 });
    const exposed = `${state.exposedCards[0]!.rank}${state.exposedCards[0]!.suit}`;

    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.communityCards.map((c) => `${c.rank}${c.suit}`)).not.toContain(exposed);
  });

  it('表になった札は場にも出ない', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 4 });
    const exposed = `${state.exposedCards[0]!.rank}${state.exposedCards[0]!.suit}`;

    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    const board = state.communityCards.map((c) => `${c.rank}${c.suit}`);
    expect(board).not.toContain(exposed);
  });

  it('同じ seed からは同じ結果が再現される', () => {
    // 再現できないと配牌の検証（docs/fairness.md）が壊れる。
    const variant = withOptions({ exposedCardChance: 0.5 });
    for (let seed = 0; seed < 20; seed++) {
      const a = reduce(tableOf(4, variant), { type: 'startHand', seed });
      const b = reduce(tableOf(4, variant), { type: 'startHand', seed });
      expect(a.exposedCards).toEqual(b.exposedCards);
      expect(a.players.map((p) => p.holeCards)).toEqual(b.players.map((p) => p.holeCards));
    }
  });

  it('確率に応じた頻度で起きる', () => {
    const variant = withOptions({ exposedCardChance: 0.5 });
    let happened = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (exposedCount(reduce(tableOf(4, variant), { type: 'startHand', seed })) > 0) happened++;
    }
    expect(happened).toBeGreaterThan(70);
    expect(happened).toBeLessThan(130);
  });

  it('次のハンドでは持ち越さない', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 1 });
    expect(exposedCount(state)).toBe(1);

    state = foldDown(state);
    state = reduce(state, { type: 'startHand', seed: 2 });
    expect(exposedCount(state)).toBe(1); // 前のが積み重なっていない
  });
});

describe('必要枚数の見込み', () => {
  it('別途焼く設定では1枚多く見込む', () => {
    const standard = withOptions({ exposedCardChance: 0.5 });
    const separate = withOptions({ exposedCardChance: 0.5, exposedCardBecomesBurn: false });
    expect(extraCardsFor(standard)).toBe(0);
    expect(extraCardsFor(separate)).toBe(1);
  });

  it('露出しない卓では余分を見込まない', () => {
    expect(extraCardsFor(STANDARD_VARIANT)).toBe(0);
    expect(extraCardsFor(withOptions({ exposedCardBecomesBurn: false }))).toBe(0);
  });

  it('ぎりぎりのデッキでは、余分のぶん開始が弾かれる', () => {
    // 手札2枚×2人 + 場5 + バーン3 = 12枚ちょうどのデッキ
    const tight = {
      suits: ['spades', 'hearts', 'diamonds'] as const,
      ranks: ['Q', 'K', 'A'] as const,
    };
    const exact: Variant = {
      ...withOptions({ exposedCardChance: 0.5 }),
      deck: { suits: [...tight.suits], ranks: [...tight.ranks] },
    };
    const needsMore: Variant = {
      ...exact,
      options: { ...exact.options, exposedCardBecomesBurn: false },
    };

    // 9枚のデッキでは2人でも足りない（12枚要る）ので、どちらも弾かれる
    expect(reduce(tableOf(2, exact), { type: 'startHand', seed: 1 }).phase).toBe('waiting');
    expect(reduce(tableOf(2, needsMore), { type: 'startHand', seed: 1 }).phase).toBe('waiting');
  });
});

describe('ミスディール（配り直し）', () => {
  it('既定では起きない', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed }).misdeals).toBe(0);
    }
  });

  it('起きた回数が記録される', () => {
    const variant = withOptions({ exposedCardChance: 1, misdeal: true });
    const state = reduce(tableOf(3, variant), { type: 'startHand', seed: 1 });
    // 上限まで配り直したうえで、最後は配られる（無限に回らない）
    expect(state.misdeals).toBeGreaterThan(0);
    expect(state.phase).toBe('betting');
    for (const p of state.players) expect(p.holeCards).toHaveLength(2);
  });

  it('配り直すと配牌が変わる', () => {
    const plain = reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 1 });
    const redealt = reduce(tableOf(3, withOptions({ exposedCardChance: 1, misdeal: true })), {
      type: 'startHand',
      seed: 1,
    });
    expect(redealt.players.map((p) => p.holeCards)).not.toEqual(
      plain.players.map((p) => p.holeCards),
    );
  });

  it('オフならミスは1枚までで、配り直さない', () => {
    const variant = withOptions({ exposedCardChance: 1 });
    for (let seed = 0; seed < 10; seed++) {
      const state = reduce(tableOf(3, variant), { type: 'startHand', seed });
      expect(state.misdeals).toBe(0);
      expect(state.exposedCards).toHaveLength(1);
    }
  });

  it('前の版の確率の指定は「2枚目もありうる」として読む', () => {
    const parsed = parseVariant({ ...JSON.parse(variantToJson(STANDARD_VARIANT)), options: { exposedCardChance: 0.1, misdealChance: 0.05 } });
    expect(parsed.ok && parsed.variant.options?.misdeal).toBe(true);
  });

  it('配り直しも seed から再現される', () => {
    const variant = withOptions({ exposedCardChance: 0.5, misdeal: true });
    for (let seed = 0; seed < 15; seed++) {
      const a = reduce(tableOf(3, variant), { type: 'startHand', seed });
      const b = reduce(tableOf(3, variant), { type: 'startHand', seed });
      expect(a.misdeals).toBe(b.misdeals);
      expect(a.players.map((p) => p.holeCards)).toEqual(b.players.map((p) => p.holeCards));
    }
  });
});

// ============================================================
// 手札を見せる
// ============================================================

describe('自分の手札を見せる', () => {
  const showdown = (variant: Variant): GameState => {
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 1 });
    return foldDown(state);
  };

  it('既定では見せられない', () => {
    const state = showdown(STANDARD_VARIANT);
    expect(validate(state, { type: 'showCard', playerId: 'p0', index: 0 })).toEqual({
      reason: 'この卓では手札を見せられない',
    });
  });

  it('有効なら決着後に見せられる', () => {
    const state = showdown(withOptions({ showCards: 'any' }));
    expect(state.phase).toBe('showdown');
    const after = reduce(state, { type: 'showCard', playerId: 'p0', index: 0 });
    expect(after.players.find((p) => p.id === 'p0')!.exposedHoleCards).toEqual([0]);
  });

  it('見せた札は他の人にも見える', () => {
    const state = reduce(showdown(withOptions({ showCards: 'any' })), {
      type: 'showCard',
      playerId: 'p0',
      index: 1,
    });
    const seen = project(state, 'p1').players.find((p) => p.id === 'p0')!;
    expect(seen.holeCards[1]).not.toBeNull();
    expect(seen.holeCards[0]).toBeNull();
  });

  it("'one' なら1枚までしか見せられない", () => {
    let state = showdown(withOptions({ showCards: 'one' }));
    state = reduce(state, { type: 'showCard', playerId: 'p0', index: 0 });
    expect(validate(state, { type: 'showCard', playerId: 'p0', index: 1 })).toEqual({
      reason: 'この卓では1枚までしか見せられない',
    });
  });

  it("'any' なら何枚でも見せられる", () => {
    let state = showdown(withOptions({ showCards: 'any' }));
    state = reduce(state, { type: 'showCard', playerId: 'p0', index: 0 });
    state = reduce(state, { type: 'showCard', playerId: 'p0', index: 1 });
    expect(state.players.find((p) => p.id === 'p0')!.exposedHoleCards).toEqual([0, 1]);
  });

  it('同じ札を二度は見せられない', () => {
    let state = showdown(withOptions({ showCards: 'any' }));
    state = reduce(state, { type: 'showCard', playerId: 'p0', index: 0 });
    expect(validate(state, { type: 'showCard', playerId: 'p0', index: 0 })).toEqual({
      reason: 'もう表になっている',
    });
  });

  it('無い位置は指定できない', () => {
    const state = showdown(withOptions({ showCards: 'any' }));
    expect(validate(state, { type: 'showCard', playerId: 'p0', index: 5 })).toEqual({
      reason: 'その位置に札がない',
    });
  });

  it('勝負の途中では見せられない', () => {
    // 途中で見せられると駆け引きが成立しなくなる。
    const state = reduce(tableOf(3, withOptions({ showCards: 'any' })), {
      type: 'startHand',
      seed: 1,
    });
    expect(state.phase).toBe('betting');
    expect(validate(state, { type: 'showCard', playerId: 'p0', index: 0 })).toEqual({
      reason: '勝負がついてから見せられる',
    });
  });

  it('降りたあとなら途中でも見せられる', () => {
    let state = reduce(tableOf(3, withOptions({ showCards: 'any' })), {
      type: 'startHand',
      seed: 1,
    });
    const folder = state.turnPlayerId!;
    state = reduce(state, { type: 'fold', playerId: folder });
    expect(state.phase).toBe('betting'); // まだ2人残っている

    expect(validate(state, { type: 'showCard', playerId: folder, index: 0 })).toBeNull();
  });
});

// ============================================================
// ラビットハント
// ============================================================

describe('ラビットハント', () => {
  it('既定では見せない', () => {
    const state = foldDown(reduce(tableOf(3, STANDARD_VARIANT), { type: 'startHand', seed: 1 }));
    expect(state.summary!.rabbit).toEqual([]);
  });

  it('プリフロップで流れたら残り5枚ぶんが見える', () => {
    const variant = withOptions({ rabbitHunt: true });
    const state = foldDown(reduce(tableOf(3, variant), { type: 'startHand', seed: 1 }));
    // フロップ3 + ターン1 + リバー1
    expect(state.summary!.rabbit).toHaveLength(5);
  });

  it('フロップで流れたら残り2枚ぶん', () => {
    const variant = withOptions({ rabbitHunt: true });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 2 });
    state = callAround(state); // フロップへ
    expect(state.streetIndex).toBe(0);

    state = foldDown(state);
    expect(state.phase).toBe('showdown');
    expect(state.summary!.rabbit).toHaveLength(2);
  });

  it('最後まで進んだハンドでは何も出ない', () => {
    const variant = withOptions({ rabbitHunt: true });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 3 });
    for (let i = 0; i < 4 && state.phase === 'betting'; i++) state = callAround(state);
    expect(state.phase).toBe('showdown');
    expect(state.summary!.rabbit).toEqual([]);
  });

  it('見せた札は場に出た札と重複しない', () => {
    const variant = withOptions({ rabbitHunt: true });
    let state = reduce(tableOf(3, variant), { type: 'startHand', seed: 7 });
    state = callAround(state);
    state = foldDown(state);

    const board = new Set(state.communityCards.map((c) => `${c.rank}${c.suit}`));
    for (const card of state.summary!.rabbit) {
      expect(board.has(`${card.rank}${card.suit}`)).toBe(false);
    }
  });

  it('バーンカードは飛ばして数える', () => {
    // 残り2ストリート（ターン・リバー）はそれぞれバーン1枚ずつ。
    // 山札の 0,1,2,3 のうち、見えるのは 1 と 3 番目。
    const deck = [
      { rank: '2', suit: 'spades' },
      { rank: '3', suit: 'spades' },
      { rank: '4', suit: 'spades' },
      { rank: '5', suit: 'spades' },
    ] as const;
    const rabbit = rabbitCards(STANDARD_VARIANT.structure, 0, [...deck]);
    expect(rabbit).toEqual([deck[1], deck[3]]);
  });

  it('山札が尽きていたらそこまでしか出さない', () => {
    const rabbit = rabbitCards(STANDARD_VARIANT.structure, 0, [
      { rank: '2', suit: 'spades' },
      { rank: '3', suit: 'spades' },
    ]);
    expect(rabbit).toHaveLength(1);
  });
});
