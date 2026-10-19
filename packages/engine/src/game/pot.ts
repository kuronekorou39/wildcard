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
 * committed の額ごとにポットを層に分ける。
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
    layers.push({ amount, eligiblePlayerIds });
  }

  if (carry > 0 && contenders.length > 0) {
    layers.push({ amount: carry, eligiblePlayerIds: contenders.map((p) => p.id) });
  }

  return layers;
}

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
