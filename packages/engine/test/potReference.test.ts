import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng.js';
import {
  awardPotsAcrossRuns,
  buildPotLayers,
  returnUncalledBets,
} from '../src/game/pot.js';
import { boardsOf, createGame, legalActions, reduce, validate } from '../src/game/reduce.js';
import { compareHands, evaluateHand, type HandResult } from '../src/rules/evaluate.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import type { Action, GameState, Payout, Player, Variant } from '../src/types.js';

/**
 * ポット配分の差分テスト。
 *
 * テストの中に「見れば正しいと分かる」小さな参照実装を置き、ランダムに作った
 * 大量の決着場面でエンジンの配当と1枚単位で突き合わせる。
 * 役の強さは別のテストで確かめているので、ここでは与えられたものとして扱う
 * （比較は compareHands に任せ、強さは架空の HandResult で作る）。
 *
 * 参照実装は一般的な卓のルールで層を切る。サイドポットは降りていない人の額でだけ分かれ、
 * 降りた人の額はそのポットに入るだけ（デッドマネー）。
 * 以前のエンジンは降りた人の額でも層を切っていて、層ごとに出る端数が同じ人に偏っていた。
 */

// ============================================================
// 参照実装
// ============================================================

interface Seat {
  readonly id: string;
  readonly seat: number;
  readonly committed: number;
  readonly folded: boolean;
  readonly inHand: boolean;
}

interface Settlement {
  /** 返却 + 配当。summary.payouts に当たる。 */
  readonly credited: Record<string, number>;
  /** 返却のみ。 */
  readonly refunds: Record<string, number>;
  /** 配当のみ。summary.awards に当たる。 */
  readonly awards: Record<string, number>;
  /** 走りごとの配当。1本でも1要素入れる。 */
  readonly perRun: Record<string, number>[];
}

const isLive = (p: Seat) => p.inHand && !p.folded;

function addTo(record: Record<string, number>, id: string, amount: number): void {
  if (amount <= 0) return;
  record[id] = (record[id] ?? 0) + amount;
}

/**
 * 参照実装。エンジンのコードを見ずに、卓のルールを素直に書き下したもの。
 *
 * 1. 一番多く出した人が1人だけなら、2番目との差は誰も受けていないので戻る。
 * 2. 降りていない人の出した額ごとにポットを作る。区切りの間の額は、そこまで出した全員
 *    （降りた人も含む）から集まり、区切りの上端まで出した「降りていない人」だけが取り合う。
 * 3. 走りが複数あれば、各ポットを本数で等分し（端数は先の走りから1枚ずつ）、
 *    走りごとに最強の手へ配る。
 * 4. 引き分けの端数は、ディーラーの次の席から時計回りに1枚ずつ。
 */
function referenceSettle(
  players: readonly Seat[],
  handsPerRun: readonly ReadonlyMap<string, HandResult>[],
  dealerSeat: number,
  seatCount: number,
): Settlement {
  const refunds: Record<string, number> = {};
  const awards: Record<string, number> = {};

  // 1. コールされなかった分
  const sorted = [...players].sort((a, b) => b.committed - a.committed);
  const top = sorted[0]?.committed ?? 0;
  const second = sorted[1]?.committed ?? 0;
  const effective = new Map(players.map((p) => [p.id, p.committed]));
  if (top > second) {
    addTo(refunds, sorted[0]!.id, top - second);
    effective.set(sorted[0]!.id, second);
  }
  const eff = (p: Seat) => effective.get(p.id)!;

  const live = players.filter(isLive);
  const runs = Math.max(1, handsPerRun.length);
  const perRun: Record<string, number>[] = Array.from({ length: runs }, () => ({}));
  const pot = players.reduce((sum, p) => sum + eff(p), 0);

  if (live.length === 1) {
    // 全員が降りた。役は見ない。
    addTo(awards, live[0]!.id, pot);
  } else {
    // 2. 区切り
    const cuts = [...new Set(live.map(eff).filter((c) => c > 0))].sort((a, b) => a - b);
    const max = Math.max(...players.map(eff));
    if (!cuts.includes(max)) cuts.push(max);

    let lo = 0;
    for (const hi of cuts) {
      const amount = players.reduce((sum, p) => sum + Math.max(0, Math.min(eff(p), hi) - lo), 0);
      const eligible = live.filter((p) => eff(p) >= hi);
      if (eligible.length === 0) throw new Error('参照実装: 取り合う人のいないポットは生成しない前提');
      lo = hi;
      if (amount === 0) continue;

      // 3. 走りごとに等分
      for (let run = 0; run < runs; run++) {
        const share = Math.floor(amount / runs) + (run < amount % runs ? 1 : 0);
        const hands = handsPerRun[run]!;
        const contenders = eligible.filter((p) => hands.has(p.id));
        const best = contenders.reduce<HandResult | null>((b, p) => {
          const h = hands.get(p.id)!;
          return b === null || compareHands(h, b) > 0 ? h : b;
        }, null);
        const winners = contenders.filter((p) => compareHands(hands.get(p.id)!, best!) === 0);
        // 4. 端数はディーラーの次の席から
        const distance = (p: Seat) => (p.seat - dealerSeat - 1 + seatCount) % seatCount;
        winners.sort((a, b) => distance(a) - distance(b));
        const each = Math.floor(share / winners.length);
        const odd = share - each * winners.length;
        winners.forEach((w, i) => {
          const amountFor = each + (i < odd ? 1 : 0);
          addTo(perRun[run]!, w.id, amountFor);
          addTo(awards, w.id, amountFor);
        });
      }
    }
  }

  const credited: Record<string, number> = {};
  for (const [id, a] of Object.entries(refunds)) addTo(credited, id, a);
  for (const [id, a] of Object.entries(awards)) addTo(credited, id, a);
  return { credited, refunds, awards, perRun };
}

// ============================================================
// エンジン側（reduce.ts の settle と同じ順で pot.ts を呼ぶ）
// ============================================================

function toPlayer(s: Seat): Player {
  return {
    id: s.id,
    name: s.id,
    seat: s.seat,
    chips: 0,
    bet: 0,
    committed: s.committed,
    holeCards: [],
    exposedHoleCards: [],
    inHand: s.inHand,
    folded: s.folded,
    allIn: false,
    hasActed: true,
    waiting: false,
    away: false,
    straddleOn: false,
    leaving: false,
  };
}

const toRecord = (payouts: readonly Payout[]): Record<string, number> => {
  const record: Record<string, number> = {};
  for (const { playerId, amount } of payouts) addTo(record, playerId, amount);
  return record;
};

function engineSettle(
  seats: readonly Seat[],
  handsPerRun: readonly ReadonlyMap<string, HandResult>[],
  dealerSeat: number,
  seatCount: number,
): Settlement {
  const { players: refunded, refunds } = returnUncalledBets(seats.map(toPlayer));
  const live = refunded.filter((p) => p.inHand && !p.folded);
  const layers = buildPotLayers(refunded);
  const seatOf = new Map(refunded.map((p) => [p.id, p.seat]));

  let awards: Payout[];
  let perRun: Payout[][];
  if (live.length === 1) {
    awards = [{ playerId: live[0]!.id, amount: layers.reduce((s, l) => s + l.amount, 0) }];
    perRun = [awards];
  } else {
    const awarded = awardPotsAcrossRuns(layers, handsPerRun, seatOf, dealerSeat, seatCount);
    awards = awarded.payouts;
    perRun = awarded.perRun;
  }

  const credited: Record<string, number> = {};
  for (const { playerId, amount } of [...refunds, ...awards]) addTo(credited, playerId, amount);
  return {
    credited,
    refunds: toRecord(refunds),
    awards: toRecord(awards),
    perRun: perRun.map(toRecord),
  };
}

// ============================================================
// ランダムな決着場面
// ============================================================

/** 強さだけを持つ架空の手。rankingIndex は小さいほど強い。 */
function fakeHand(rankingIndex: number, tiebreak: number): HandResult {
  return {
    rankingId: `r${rankingIndex}`,
    rankingName: `r${rankingIndex}`,
    rankingIndex,
    cards: [],
    resolved: [],
    matched: [],
    kickers: [],
    tiebreak: [tiebreak],
  };
}

interface Scenario {
  readonly seats: Seat[];
  readonly handsPerRun: Map<string, HandResult>[];
  readonly dealerSeat: number;
  readonly seatCount: number;
}

const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!;

/**
 * 実際の卓で起こりうる決着場面を作る。
 *
 * 同額・オールイン・フォールドが頻出するよう、出した額は少数の候補から選ぶ。
 * 強さも数段階しかないので引き分けが多い。
 * 「一番多く出した人が全員降りている」場面は実際には起きない
 * （降りる相手が残らない）ので、その場合は1人を降りていないことにする。
 */
function randomScenario(rng: () => number, options: { realistic: boolean } = { realistic: true }): Scenario {
  const count = 2 + Math.floor(rng() * 8); // 2〜9人
  const seatCount = count + Math.floor(rng() * (11 - count)); // count〜10席
  const seatPool = Array.from({ length: seatCount }, (_, i) => i);
  for (let i = seatPool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [seatPool[i], seatPool[j]] = [seatPool[j]!, seatPool[i]!];
  }

  // 同額が出やすいよう、額の候補を少数に絞る。奇数も混ぜる。
  const levels = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => 1 + Math.floor(rng() * 60));

  let seats: Seat[] = Array.from({ length: count }, (_, i) => {
    const inHand = rng() > 0.05;
    const folded = inHand && rng() < 0.35;
    const committed = !inHand
      ? 0
      : folded && rng() < 0.2
        ? 0
        : rng() < 0.15
          ? 1 + Math.floor(rng() * 120)
          : pick(rng, levels);
    return { id: `p${i}`, seat: seatPool[i]!, committed, folded, inHand };
  });

  if (options.realistic) {
    // 降りていない人は何かしら出している（ブラインドかコールで）
    seats = seats.map((s) => (isLive(s) && s.committed === 0 ? { ...s, committed: levels[0]! } : s));
    // ブラインドがあるので、少なくとも2人は出している
    for (let i = 0; seats.filter((s) => s.committed > 0).length < 2; i++) {
      if (seats[i]!.committed === 0) seats[i] = { ...seats[i]!, inHand: true, committed: levels[0]! };
    }
    // コールされなかった分を戻したあとの最大額（＝2番目に多い額）に、降りていない人が必ずいる
    const effMax = seats.map((s) => s.committed).sort((a, b) => b - a)[1]!;
    const atTop = seats.filter((s) => s.committed >= effMax);
    if (!atTop.some(isLive)) {
      const chosen = pick(rng, atTop);
      seats = seats.map((s) => (s.id === chosen.id ? { ...s, inHand: true, folded: false } : s));
    }
  }

  const runs = rng() < 0.6 ? 1 : rng() < 0.6 ? 2 : 3;
  const handsPerRun = Array.from({ length: runs }, () => {
    const hands = new Map<string, HandResult>();
    for (const s of seats) {
      if (!isLive(s)) continue;
      hands.set(s.id, fakeHand(Math.floor(rng() * 3), Math.floor(rng() * 3)));
    }
    return hands;
  });

  const occupied = seats.map((s) => s.seat);
  const dealerSeat = rng() < 0.8 ? pick(rng, occupied) : Math.floor(rng() * seatCount);
  return { seats, handsPerRun, dealerSeat, seatCount };
}

const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);

const describeScenario = (s: Scenario) =>
  JSON.stringify({
    dealerSeat: s.dealerSeat,
    seatCount: s.seatCount,
    seats: s.seats,
    hands: s.handsPerRun.map((h) =>
      Object.fromEntries([...h].map(([id, r]) => [id, `${r.rankingIndex}/${r.tiebreak[0]}`])),
    ),
  });

const SCENARIOS = 20000;

// ============================================================
// テスト
// ============================================================

describe('参照実装との突き合わせ（ランダムな決着場面）', () => {
  it(`${SCENARIOS} 件の場面で、一般的な卓のルールと1枚単位で一致する`, () => {
    const rng = createRng(20261102);
    let multiRun = 0;
    let foldOut = 0;
    for (let i = 0; i < SCENARIOS; i++) {
      const s = randomScenario(rng);
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const ref = referenceSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const context = `#${i} ${describeScenario(s)}`;

      expect(engine.refunds, `${context}: 返却`).toEqual(ref.refunds);
      expect(engine.awards, `${context}: 配当`).toEqual(ref.awards);
      expect(engine.credited, `${context}: 合計`).toEqual(ref.credited);
      if (s.seats.filter(isLive).length > 1) {
        expect(engine.perRun, `${context}: 走りごとの配当`).toEqual(ref.perRun);
      } else {
        foldOut++;
      }
      if (s.handsPerRun.length > 1) multiRun++;
    }
    // 生成が偏っていないこと（複数本・全員降りが十分に含まれる）
    expect(multiRun).toBeGreaterThan(SCENARIOS / 5);
    expect(foldOut).toBeGreaterThan(SCENARIOS / 100);
  });
});

describe('配当の性質', () => {
  const rng = createRng(4242);
  const scenarios = Array.from({ length: 5000 }, () => randomScenario(rng));

  it('配った総額は出された総額に一致する', () => {
    for (const s of scenarios) {
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const committed = s.seats.reduce((a, p) => a + p.committed, 0);
      expect(sum(engine.credited), describeScenario(s)).toBe(committed);
      // 走りごとの配当を足すと全体の配当になる
      const perRunTotal = engine.perRun.reduce((a, r) => a + sum(r), 0);
      expect(perRunTotal, describeScenario(s)).toBe(sum(engine.awards));
    }
  });

  it('自分が取り合える層の合計より多くは取れない', () => {
    for (const s of scenarios) {
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const sorted = s.seats.map((p) => p.committed).sort((a, b) => b - a);
      const cap = sorted[1] ?? 0;
      const eff = (c: number) => Math.min(c, cap);
      for (const p of s.seats) {
        // 自分の額までなら、各人から min(相手の額, 自分の額) ずつ取れる
        const winnable = s.seats.reduce((a, q) => a + Math.min(eff(q.committed), eff(p.committed)), 0);
        expect(engine.awards[p.id] ?? 0, `${describeScenario(s)}: ${p.id}`).toBeLessThanOrEqual(winnable);
      }
    }
  });

  it('降りた人・配られていない人は返却以外に何も受け取らない', () => {
    for (const s of scenarios) {
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      for (const p of s.seats) {
        if (isLive(p)) continue;
        expect(engine.awards[p.id], `${describeScenario(s)}: ${p.id}`).toBeUndefined();
        expect(engine.credited[p.id] ?? 0).toBe(engine.refunds[p.id] ?? 0);
      }
    }
  });

  it('引き分けた人同士の取り分の差は、層の数×走りの数を超えない', () => {
    // 同じ層を同じ強さで取り合った人の差は端数ぶんだけ。全層で同じ立場の人で確かめる。
    for (const s of scenarios) {
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const live = s.seats.filter(isLive);
      const slack = new Set(s.seats.map((x) => x.committed)).size * s.handsPerRun.length;
      for (const a of live) {
        for (const b of live) {
          if (a.committed !== b.committed) continue;
          const tied = s.handsPerRun.every((h) => compareHands(h.get(a.id)!, h.get(b.id)!) === 0);
          if (!tied) continue;
          const diff = Math.abs((engine.credited[a.id] ?? 0) - (engine.credited[b.id] ?? 0));
          expect(diff, describeScenario(s)).toBeLessThanOrEqual(slack);
        }
      }
    }
  });

  it('プレイヤーの並び順を入れ替えても結果は変わらない', () => {
    const shuffle = createRng(99);
    for (const s of scenarios) {
      const base = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const shuffled = [...s.seats];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(shuffle() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      const again = engineSettle(shuffled, s.handsPerRun, s.dealerSeat, s.seatCount);
      expect(again.credited, describeScenario(s)).toEqual(base.credited);
      expect(again.perRun, describeScenario(s)).toEqual(base.perRun);
    }
  });

  it('席とディーラーを一緒に回しても結果は変わらない（端数の規則は席の相対位置だけで決まる）', () => {
    for (const s of scenarios) {
      const base = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const shift = 1 + (s.seats.length % (s.seatCount - 1 || 1));
      const rotated = s.seats.map((p) => ({ ...p, seat: (p.seat + shift) % s.seatCount }));
      const again = engineSettle(rotated, s.handsPerRun, (s.dealerSeat + shift) % s.seatCount, s.seatCount);
      expect(again.credited, describeScenario(s)).toEqual(base.credited);
    }
  });

  it('ありえない場面（最大額の人が全員降りている）でもチップは消えない', () => {
    // 実際には起きないが、buildPotLayers は繰り越しで落とさないと書いてある。
    const wild = createRng(31337);
    for (let i = 0; i < 3000; i++) {
      const s = randomScenario(wild, { realistic: false });
      if (!s.seats.some(isLive)) continue;
      const engine = engineSettle(s.seats, s.handsPerRun, s.dealerSeat, s.seatCount);
      const committed = s.seats.reduce((a, p) => a + p.committed, 0);
      expect(sum(engine.credited), describeScenario(s)).toBe(committed);
    }
  });
});

describe('狙った例', () => {
  const tie = (ids: string[]) => new Map(ids.map((id) => [id, fakeHand(0, 0)]));
  const seat = (id: string, s: number, committed: number, folded = false): Seat => ({
    id,
    seat: s,
    committed,
    folded,
    inHand: true,
  });

  it('3人が同額でオールイン、全員引き分けで 100 を割ると端数1枚はディーラーの次へ', () => {
    // 33/33/34 ではなく、ディーラー(席2)の次＝席0 が 34
    const players = [seat('A', 0, 33), seat('B', 1, 33), seat('C', 2, 33)];
    const withDead = [...players, seat('D', 3, 1, true)];
    const engine = engineSettle(withDead, [tie(['A', 'B', 'C'])], 2, 4);
    expect(engine.credited).toEqual({ A: 34, B: 33, C: 33 });
  });

  it('2本走りで 2本とも引き分け、奇数ポットの端数は1本目に乗りそこで席順に配られる', () => {
    // ポット 3 → 1本目 2、2本目 1。2本目の1枚は、引き分けた A・B のうち
    // ディーラー(席1)の次から時計回りで先に来る A へ（C は負けているので対象外）。
    const players = [seat('A', 0, 1), seat('B', 1, 1), seat('C', 2, 1)];
    const hands = () => new Map([...tie(['A', 'B']), ['C', fakeHand(1, 0)]]);
    const engine = engineSettle(players, [hands(), hands()], 1, 3);
    expect(engine.perRun).toEqual([{ A: 1, B: 1 }, { A: 1 }]);
    expect(engine.credited).toEqual({ A: 2, B: 1 });
  });

  /**
   * 以前の不具合: 降りた人の額でも層が切られ、端数が1人に寄っていた。
   *
   * A, B（降りていない、どちらも 3 出して引き分け）、C, D（1 出して降りた）、E（2 出して降りた）。
   * ポットは 10 で、A と B は同じ全額を取り合う立場なので 5 / 5。
   * 以前は額 1, 2, 3 ごとに層を切り（5 / 3 / 2）、層ごとの端数が両方 A に行って 6 / 4 になっていた。
   */
  it('降りた人の額があっても、端数は1つのポットぶんしか出ない', () => {
    const players = [
      seat('A', 0, 3),
      seat('B', 1, 3),
      seat('C', 2, 1, true),
      seat('D', 3, 1, true),
      seat('E', 4, 2, true),
    ];
    const engine = engineSettle(players, [tie(['A', 'B'])], 4, 5);
    expect(engine.credited).toEqual({ A: 5, B: 5 });
  });

  /**
   * 上と同じ原因で、複数本走ると偏りが「層の数 × 本数」に広がっていた。
   *
   * A, B（降りていない、2 ずつ出して2本とも引き分け）、C（1 出して降りた）。ポットは 5。
   * 1つのポット 5 を2本に 3 / 2 で分け、端数が出るのは1本目の1枚だけなので A = 3, B = 2。
   * 「SB が降り、残り2人がオールインして2本走り、2本とも引き分け」で起きる形。以前は 4 / 1 だった。
   */
  it('2本走りでも、降りた人の額のせいで引き分けの取り分が大きく偏らない', () => {
    const players = [seat('A', 0, 2), seat('B', 1, 2), seat('C', 2, 1, true)];
    const engine = engineSettle(players, [tie(['A', 'B']), tie(['A', 'B'])], 1, 3);
    expect(engine.credited).toEqual({ A: 3, B: 2 });
  });
});

// ============================================================
// reduce() を通した対局での突き合わせ
// ============================================================

const RUN_VARIANT: Variant = {
  ...STANDARD_VARIANT,
  options: { ...STANDARD_VARIANT.options, runItTwice: { max: 3 } },
};

/** オールインが起きやすいよう、レイズは半分の確率で全額にする。 */
function randomAction(state: GameState, rng: () => number): Action {
  const playerId = state.turnPlayerId!;
  if (state.phase === 'runChoice') {
    return { type: 'runItTwice', playerId, agree: rng() < 0.7 };
  }
  const legal = legalActions(state, playerId)!;
  const choices: Action[] = [];
  if (legal.canFold) choices.push({ type: 'fold', playerId });
  if (legal.canCheck) choices.push({ type: 'check', playerId });
  if (legal.canCall) choices.push({ type: 'call', playerId }, { type: 'call', playerId });
  if (legal.canRaise) {
    const to =
      rng() < 0.5
        ? legal.maxRaiseTo
        : legal.minRaiseTo + Math.floor(rng() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
    choices.push({ type: 'raise', playerId, to });
  }
  return pick(rng, choices);
}

describe('reduce() を通した対局での突き合わせ', () => {
  it('ランダムな対局の決着が参照実装と一致する（2本・3本走りを含む）', () => {
    const rng = createRng(9001);
    let hands = 0;
    let multiRun = 0;
    let sidePots = 0;

    for (let game = 0; game < 60; game++) {
      const count = 2 + Math.floor(rng() * 8);
      const ante = rng() < 0.3 ? 1 + Math.floor(rng() * 5) : 0;
      let state = createGame({ seatCount: 10, smallBlind: 5, bigBlind: 10, ante, variant: RUN_VARIANT });
      const seats = Array.from({ length: 10 }, (_, i) => i).filter(() => rng() < 0.8).slice(0, count);
      if (seats.length < 2) continue;
      seats.forEach((seat, i) => {
        // スタックをばらばらにしてサイドポットを作る。奇数も混ぜる。
        const chips = 5 + Math.floor(rng() * 300);
        state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat, chips });
      });
      const tableTotal = state.players.reduce((a, p) => a + p.chips, 0);

      for (let h = 0; h < 15; h++) {
        const seed = game * 100 + h;
        if (validate(state, { type: 'startHand', seed })) break;
        const before = new Map(state.players.map((p) => [p.id, p.chips]));
        state = reduce(state, { type: 'startHand', seed });

        let steps = 0;
        while (state.phase !== 'showdown') {
          state = reduce(state, randomAction(state, rng));
          expect(++steps).toBeLessThan(500);
        }
        hands++;

        const summary = state.summary!;
        const credited = toRecord(summary.payouts);
        // 出した額は「始まる前 − 終わった後 + 受け取った額」で復元できる
        const seatsOf: Seat[] = state.players.map((p) => ({
          id: p.id,
          seat: p.seat,
          committed: before.get(p.id)! - p.chips + (credited[p.id] ?? 0),
          folded: p.folded,
          inHand: p.inHand,
        }));
        const live = seatsOf.filter(isLive);
        const boards = boardsOf(state);
        const handsPerRun =
          live.length > 1
            ? boards.map((board) => {
                const m = new Map<string, HandResult>();
                for (const p of state.players) {
                  if (!p.inHand || p.folded) continue;
                  const r = evaluateHand(p.holeCards, board, state.variant);
                  if (r) m.set(p.id, r);
                }
                return m;
              })
            : [new Map<string, HandResult>()];

        const ref = referenceSettle(seatsOf, handsPerRun, state.dealerSeat, state.seatCount);
        const context = `game=${game} hand=${h} ${JSON.stringify(seatsOf)} dealer=${state.dealerSeat}`;
        expect(credited, `${context}: 合計`).toEqual(ref.credited);
        expect(toRecord(summary.awards ?? []), `${context}: 配当`).toEqual(ref.awards);
        if (boards.length > 1) {
          multiRun++;
          expect(summary.runs!.map((r) => toRecord(r.payouts)), `${context}: 走りごと`).toEqual(ref.perRun);
        } else {
          expect(summary.runs, context).toBeUndefined();
        }
        if (new Set(live.map((p) => p.committed)).size > 1) sidePots++;

        // 卓のチップ総量は変わらない
        expect(state.players.reduce((a, p) => a + p.chips, 0) + state.pot, context).toBe(tableTotal);
      }
    }

    expect(hands).toBeGreaterThan(300);
    expect(multiRun).toBeGreaterThan(10);
    expect(sidePots).toBeGreaterThan(10);
  });
});
