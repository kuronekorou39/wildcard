import { potsInPlay, type VisibleState } from '@wildcard/engine';

/** 1つ目がメインポット、続きがサイドポット1, 2, …。 */
export const potLabel = (index: number): string => (index === 0 ? 'メインポット' : `サイドポット${index}`);
/** 卓の中央に並べる短い呼び方。 */
export const shortPotLabel = (index: number): string => (index === 0 ? 'メイン' : `サイド${index}`);

/**
 * 卓の中央に出すポットの額（メイン、サイド1, 2, …の順）。
 * ハンド中はオールインした人の額で分け、決着したら配った内訳をそのまま使う。
 * 1つしか無ければ内訳は出さないので、呼ぶ側は2つ以上のときだけ並べればよい。
 */
export function tablePots(state: VisibleState): readonly number[] {
  if (state.phase === 'showdown') return (state.summary?.pots ?? []).map((pot) => pot.amount);
  if (state.phase === 'waiting') return [];
  return potsInPlay(state.players).map((pot) => pot.amount);
}
