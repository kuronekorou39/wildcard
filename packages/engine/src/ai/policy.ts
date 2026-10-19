import type { Action, GameState } from '../types.js';
import { legalActions } from '../game/reduce.js';
import { createRng } from '../rng.js';
import { estimateEquity, suggestedSamples } from './equity.js';

/**
 * CPU の打ち方。
 *
 * 勝率（estimateEquity）とポットオッズだけで決める。役の名前も
 * 「AAは強い」といった知識も一切使わないので、カードの強さや役の順位が
 * 差し替わっても同じコードがそのまま働く。
 *
 * 強さは求めていない。**人間が一人でも遊べる相手**になることが目的で、
 * 降りるべきときに降り、良い手では払わせる、という最低限の筋が通っていればよい。
 */

export interface CpuStyle {
  /** 0 に近いほど慎重、1 に近いほど attack 的。既定 0.5。 */
  readonly aggression: number;
  /** 勝率の推定に使う試行回数。省略すると状況から決める。 */
  readonly samples?: number;
}

export const DEFAULT_STYLE: CpuStyle = { aggression: 0.5 };

export interface CpuDecision {
  readonly action: Action;
  /** 判断の根拠。画面に出すとCPUの挙動が読めるようになる。 */
  readonly equity: number;
  readonly potOdds: number;
  readonly reason: string;
}

/**
 * その局面での CPU の一手を決める。
 *
 * **state は手番のプレイヤー本人の視点に伏せられていなくてよいが、
 * この関数は自分のホールカードと場のカードしか見ない。** 相手の手札は
 * estimateEquity に渡らないので、覗き見した判断にはならない。
 */
export function decide(
  state: GameState,
  playerId: string,
  seed: number,
  style: CpuStyle = DEFAULT_STYLE,
): CpuDecision | null {
  const legal = legalActions(state, playerId);
  if (legal === null) return null;

  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;

  const opponents = state.players.filter(
    (p) => p.id !== playerId && p.inHand && !p.folded,
  ).length;

  const samples = style.samples ?? suggestedSamples(state.communityCards.length, opponents);
  const equity = estimateEquity({
    holeCards: me.holeCards,
    communityCards: state.communityCards,
    opponents,
    ruleSet: state.ruleSet,
    samples,
    seed,
  });

  const rng = createRng((seed ^ 0x5bf03635) >>> 0);
  const callAmount = legal.callAmount;
  // コールして勝たなければならない最低の勝率。
  const potOdds = callAmount <= 0 ? 0 : callAmount / (state.pot + callAmount);

  // 攻撃的なほど強気に見積もる。
  const bias = (style.aggression - 0.5) * 0.12;
  const adjusted = equity + bias;

  // --- 払う必要がない場合 ---
  if (legal.canCheck) {
    const shouldBet = adjusted > 0.6 && rng() < 0.35 + style.aggression * 0.4;
    if (shouldBet && legal.canRaise) {
      return {
        action: { type: 'raise', playerId, to: betSize(state, legal, adjusted, rng) },
        equity,
        potOdds,
        reason: '勝率が高いので自分から賭ける',
      };
    }
    return { action: { type: 'check', playerId }, equity, potOdds, reason: 'ただで見られる' };
  }

  // --- 払う必要がある場合 ---
  // ポットオッズに届かなければ降りる。たまにだけ粘る（読まれ切らないように）。
  if (adjusted < potOdds) {
    const bluffCall = rng() < style.aggression * 0.12;
    if (!bluffCall) {
      return {
        action: { type: 'fold', playerId },
        equity,
        potOdds,
        reason: `勝率 ${(equity * 100).toFixed(0)}% がポットオッズ ${(potOdds * 100).toFixed(0)}% に届かない`,
      };
    }
  }

  const shouldRaise = adjusted > 0.68 && rng() < 0.3 + style.aggression * 0.45;
  if (shouldRaise && legal.canRaise) {
    return {
      action: { type: 'raise', playerId, to: betSize(state, legal, adjusted, rng) },
      equity,
      potOdds,
      reason: '勝率が高いので上げる',
    };
  }

  return {
    action: { type: 'call', playerId },
    equity,
    potOdds,
    reason: `勝率 ${(equity * 100).toFixed(0)}% がポットオッズ ${(potOdds * 100).toFixed(0)}% に見合う`,
  };
}

/**
 * 賭ける額。勝率が高いほどポットに対して大きく張る。
 * 値は必ず legalActions の下限・上限に収める。
 */
function betSize(
  state: GameState,
  legal: NonNullable<ReturnType<typeof legalActions>>,
  equity: number,
  rng: () => number,
): number {
  const fraction = equity > 0.85 ? 1 : equity > 0.7 ? 0.65 : 0.4;
  const jitter = 0.85 + rng() * 0.3;
  const target = state.currentBet + Math.round(state.pot * fraction * jitter);
  return Math.min(Math.max(target, legal.minRaiseTo), legal.maxRaiseTo);
}
