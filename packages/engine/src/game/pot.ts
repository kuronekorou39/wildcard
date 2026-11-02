import type { Payout, Player } from '../types.js';
import type { HandResult } from '../rules/evaluate.js';
import { compareHands } from '../rules/evaluate.js';
import { orderClockwise } from './seats.js';

/**
 * ポットの一層。オールインが絡むと「誰が取り合えるか」が層ごとに変わる。
 */
export interface PotLayer {
  readonly amount: number;
  /** この層を取り合う資格のあるプレイヤー（フォールドしていない参加者）。 */
  readonly eligiblePlayerIds: readonly string[];
}

/**
 * 誰にもコールされなかった分を返す。
 *
 * 自分以外が出した最大額を超える分は、誰も受けていないので勝っても取れない。
 * 例) A が 100 出してオールイン、B は 50 でオールイン、C は 10 でフォールド
 *     → A の有効額は 50 になり、50 が A に戻る。
 *
 * 返り値の committed は「実際に取り合いの対象になる額」に縮められている。
 */
export function returnUncalledBets(players: readonly Player[]): {
  readonly players: Player[];
  readonly refunds: readonly Payout[];
} {
  const refunds: Payout[] = [];

  const adjusted = players.map((player) => {
    if (player.committed <= 0) return player;

    let maxOther = 0;
    for (const other of players) {
      if (other.id === player.id) continue;
      if (other.committed > maxOther) maxOther = other.committed;
    }

    const effective = Math.min(player.committed, maxOther);
    const refund = player.committed - effective;
    if (refund <= 0) return player;

    refunds.push({ playerId: player.id, amount: refund });
    return { ...player, chips: player.chips + refund, committed: effective };
  });

  return { players: adjusted, refunds };
}

/**
 * 降りていない人の出した額ごとにポットを層に分ける（取り合う顔ぶれが変わる所でだけ切る）。
 *
 * オールインしたプレイヤーは自分が出した額までの層しか取り合えない。
 * フォールドしたプレイヤーの出した額はポットに残るが、取り合う資格はない。
 *
 * 先に returnUncalledBets を通した players を渡すこと。
 */
export function buildPotLayers(players: readonly Player[]): PotLayer[] {
  const contenders = players.filter((p) => p.inHand && !p.folded);
  const levels = [...new Set(players.filter((p) => p.committed > 0).map((p) => p.committed))].sort(
    (a, b) => a - b,
  );

  const layers: PotLayer[] = [];
  let previous = 0;
  /**
   * 取り合う資格のある人がいない層の分。次に資格者のいる層へ繰り越す。
   * 最大額を出したプレイヤーは（降りる相手がいないので）フォールドできないため
   * 通常この繰り越しは起きないが、念のため落とさずに扱う。
   */
  let carry = 0;

  for (const level of levels) {
    let amount = carry;
    carry = 0;
    for (const player of players) {
      amount += Math.min(player.committed, level) - Math.min(player.committed, previous);
    }
    previous = level;
    if (amount <= 0) continue;

    const eligiblePlayerIds = contenders.filter((p) => p.committed >= level).map((p) => p.id);
    if (eligiblePlayerIds.length === 0) {
      carry = amount;
      continue;
    }
    // 降りた人の額でも段は切れるが、取り合う顔ぶれが同じなら1つのポットにまとめる。
    // 分けたままだと層ごとに端数が出て、引き分けの取り分が同じ人に偏る。
    const last = layers.at(-1);
    if (last && sameMembers(last.eligiblePlayerIds, eligiblePlayerIds)) {
      layers[layers.length - 1] = { amount: last.amount + amount, eligiblePlayerIds };
      continue;
    }
    layers.push({ amount, eligiblePlayerIds });
  }

  if (carry > 0 && contenders.length > 0) {
    layers.push({ amount: carry, eligiblePlayerIds: contenders.map((p) => p.id) });
  }

  return layers;
}

/**
 * ハンドの途中で、卓の中央に集まっているチップをポットごとに分ける（表示用）。
 *
 * 分かれ目はオールインした人の出した額だけ。オールインが無ければポットは1つ。
 * まだ前に置いてある賭け（bet）は中央に集まっていないので数えない。
 * 決着のときの分け方（buildPotLayers）と同じ顔ぶれで切るので、見えている内訳のまま配られる。
 */
export function potsInPlay(players: readonly Pick<Player, 'id' | 'committed' | 'bet' | 'allIn' | 'inHand' | 'folded'>[]): PotLayer[] {
  const live = players.filter((p) => p.inHand && !p.folded);
  const collected = (p: (typeof players)[number]) => Math.max(0, p.committed - p.bet);
  const cuts = [...new Set(live.filter((p) => p.allIn).map((p) => p.committed))].sort((a, b) => a - b);

  const pots: PotLayer[] = [];
  let previous = 0;
  for (const level of [...cuts, Infinity]) {
    const amount = players.reduce((sum, p) => sum + Math.max(0, Math.min(collected(p), level) - Math.min(collected(p), previous)), 0);
    // 最後の「まだ開いているポット」は、最後のオールインより多く出した人が取り合う。
    const eligiblePlayerIds = live.filter((p) => (level === Infinity ? p.committed > previous : p.committed >= level)).map((p) => p.id);
    previous = level;
    if (amount <= 0) continue;
    const last = pots.at(-1);
    // 取り合う人がいない（その額まで出した人が全員降りた）分や、顔ぶれが同じ分は前のポットに足す。
    if (last && (eligiblePlayerIds.length === 0 || sameMembers(last.eligiblePlayerIds, eligiblePlayerIds))) {
      pots[pots.length - 1] = { ...last, amount: last.amount + amount };
      continue;
    }
    pots.push({ amount, eligiblePlayerIds });
  }
  // 1人しか取り合えない分は、誰にも受けられていないので決着のときに本人へ戻る。ポットとしては見せない。
  const contested = pots.filter((pot, i) => i === 0 || pot.eligiblePlayerIds.length > 1);
  return contested;
}

const sameMembers = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * 各層を最強の手に配る。引き分けなら分割する。
 *
 * 割り切れない端数は、ディーラーの左隣（時計回りで次）から順に1枚ずつ配る。
 * 標準的な扱いで、かつ決定的なので再現性のあるテストが書ける。
 */
export function awardPots(
  layers: readonly PotLayer[],
  hands: ReadonlyMap<string, HandResult>,
  seatOf: ReadonlyMap<string, number>,
  dealerSeat: number,
  seatCount: number,
): Payout[] {
  const totals = new Map<string, number>();
  const add = (playerId: string, amount: number) => {
    if (amount <= 0) return;
    totals.set(playerId, (totals.get(playerId) ?? 0) + amount);
  };

  for (const layer of layers) {
    const winners = bestAmong(layer.eligiblePlayerIds, hands);
    if (winners.length === 0) continue;

    const share = Math.floor(layer.amount / winners.length);
    for (const playerId of winners) add(playerId, share);

    // 端数はディーラーの次の席から順に。
    let remainder = layer.amount - share * winners.length;
    if (remainder > 0) {
      for (const playerId of byDistanceFromDealer(winners, seatOf, dealerSeat, seatCount)) {
        if (remainder <= 0) break;
        add(playerId, 1);
        remainder--;
      }
    }
  }

  return [...totals.entries()].map(([playerId, amount]) => ({ playerId, amount }));
}

/**
 * 複数本走ったときの配当。
 *
 * **各層を本数で等分し、1本ごとに勝者へ配る。** 割り切れない端数は
 * 先の走りから1枚ずつ乗せる（合計は必ず元の額に戻る）。
 * 1本なら awardPots をそのまま呼ぶのと同じ結果になるので、
 * 走りの数で呼び分ける必要はない。
 */
export function awardPotsAcrossRuns(
  layers: readonly PotLayer[],
  handsPerRun: readonly ReadonlyMap<string, HandResult>[],
  seatOf: ReadonlyMap<string, number>,
  dealerSeat: number,
  seatCount: number,
): { readonly payouts: Payout[]; readonly perRun: Payout[][] } {
  const runs = Math.max(1, handsPerRun.length);

  const perRun = handsPerRun.map((hands, run) => {
    const share = layers.map((layer) => ({
      ...layer,
      amount: splitShare(layer.amount, runs, run),
    }));
    return awardPots(share, hands, seatOf, dealerSeat, seatCount);
  });

  const totals = new Map<string, number>();
  for (const payouts of perRun) {
    for (const { playerId, amount } of payouts) {
      totals.set(playerId, (totals.get(playerId) ?? 0) + amount);
    }
  }

  return {
    payouts: [...totals.entries()].map(([playerId, amount]) => ({ playerId, amount })),
    perRun,
  };
}

/** amount を runs 等分したうちの run 本目のぶん。端数は先の走りから。 */
const splitShare = (amount: number, runs: number, run: number): number =>
  Math.floor(amount / runs) + (run < amount % runs ? 1 : 0);

/** 候補のうち最強の手を持つプレイヤー。引き分けなら複数返す。 */
function bestAmong(
  playerIds: readonly string[],
  hands: ReadonlyMap<string, HandResult>,
): string[] {
  let winners: string[] = [];
  let best: HandResult | null = null;

  for (const playerId of playerIds) {
    const hand = hands.get(playerId);
    if (!hand) continue;
    if (best === null) {
      best = hand;
      winners = [playerId];
      continue;
    }
    const diff = compareHands(hand, best);
    if (diff > 0) {
      best = hand;
      winners = [playerId];
    } else if (diff === 0) {
      winners.push(playerId);
    }
  }

  return winners;
}

/** ディーラーの次の席から時計回りの順に並べる。 */
function byDistanceFromDealer(
  playerIds: readonly string[],
  seatOf: ReadonlyMap<string, number>,
  dealerSeat: number,
  seatCount: number,
): string[] {
  const bySeat = new Map<number, string>();
  for (const playerId of playerIds) {
    const seat = seatOf.get(playerId);
    if (seat !== undefined) bySeat.set(seat, playerId);
  }
  const ordered = orderClockwise(
    [...bySeat.keys()],
    (dealerSeat + 1) % seatCount,
    seatCount,
  );
  return ordered.map((seat) => bySeat.get(seat)!);
}
