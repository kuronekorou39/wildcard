import type { Card, RuleSet } from '../types.js';
import { buildDeck, shuffle } from '../deck.js';
import { compareHands, evaluateHand } from '../rules/evaluate.js';

/**
 * 勝率の推定。
 *
 * カスタムルールの下では「何が強い手か」をヒューリスティックで書けない。
 * 役の順位もカードの強さもデッキの中身も差し替わるので、「AAは強い」すら
 * 前提にできない。そこで実際に残りの札を配ってみて数える。
 * ルールを一切知らずに済むので、どんな RuleSet でもそのまま働く。
 *
 * 入力は **そのプレイヤーが正当に知っていること** だけにしてある。
 * 相手のホールカードを受け取らないので、覗き見した推定は型として書けない。
 */
export interface EquityInput {
  /** 自分の手札。 */
  readonly holeCards: readonly Card[];
  /** 場に出ているカード。 */
  readonly communityCards: readonly Card[];
  /** まだ降りていない相手の人数。 */
  readonly opponents: number;
  readonly ruleSet: RuleSet;
  /** 試行回数。多いほど正確で遅い。 */
  readonly samples: number;
  /** 乱数の種。エンジンは乱数を持たない（原則1）。 */
  readonly seed: number;
  /** 最終的に場に並ぶ枚数。標準のホールデムなら5。 */
  readonly boardSize?: number;
}

/**
 * 0〜1 の勝率。引き分けは人数で割った分を数える
 * （3人で分け合うなら 1/3 勝ったものとして扱う）。
 */
export function estimateEquity(input: EquityInput): number {
  const {
    holeCards,
    communityCards,
    opponents,
    ruleSet,
    samples,
    seed,
    boardSize = 5,
  } = input;

  if (opponents <= 0) return 1;
  if (samples <= 0) return 0;

  const known = new Set(
    [...holeCards, ...communityCards].map((card) => `${card.rank}${card.suit}`),
  );
  const unknown = buildDeck(ruleSet.deck).filter(
    (card) => !known.has(`${card.rank}${card.suit}`),
  );

  const boardToCome = Math.max(0, boardSize - communityCards.length);
  const needed = boardToCome + opponents * holeCards.length;
  if (unknown.length < needed) return 0; // 配りきれない組み合わせ

  let score = 0;

  for (let sample = 0; sample < samples; sample++) {
    // 試行ごとに違う並びを作る。seed から決まるので再現できる。
    const drawn = shuffle(unknown, (seed + sample * 0x9e3779b1) >>> 0);
    let cursor = 0;

    const board = [...communityCards];
    for (let i = 0; i < boardToCome; i++) board.push(drawn[cursor++]!);

    const mine = evaluateHand([...holeCards, ...board], ruleSet);
    if (!mine) continue;

    let better = 0;
    let tied = 0;
    for (let opponent = 0; opponent < opponents; opponent++) {
      const theirHole: Card[] = [];
      for (let i = 0; i < holeCards.length; i++) theirHole.push(drawn[cursor++]!);

      const theirs = evaluateHand([...theirHole, ...board], ruleSet);
      if (!theirs) continue;

      const diff = compareHands(theirs, mine);
      if (diff > 0) {
        better++;
        break; // 一人でも上がいれば、この試行は勝てない
      }
      if (diff === 0) tied++;
    }

    if (better === 0) score += 1 / (1 + tied);
  }

  return score / samples;
}

/**
 * 状況に応じた試行回数。
 *
 * ボードが揃うほど未知が減って結果が安定するので、試行を減らしても精度が落ちない。
 * プリフロップは逆に振れ幅が大きいので多めに回す。
 */
export function suggestedSamples(communityCards: number, opponents: number): number {
  const base = communityCards === 0 ? 240 : communityCards < 5 ? 180 : 120;
  // 相手が増えるほど1試行が重くなるので、人数で割って時間を揃える。
  return Math.max(60, Math.round(base / Math.max(1, opponents)));
}
