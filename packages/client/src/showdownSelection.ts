import { evaluateHand, type Card, type Variant, type VisibleState } from '@wildcard/engine';

export const sameCard = (a: Card, b: Card) => a.joker !== undefined || b.joker !== undefined
  ? a.joker === b.joker : a.rank === b.rank && a.suit === b.suit;
export const usesCard = (cards: readonly Card[], card: Card | null) => card !== null && cards.some(c => sameCard(c, card));

/** Evaluate against distinct physical positions, including identical ranks/suits. */
export function selectedPositions(hole: readonly Card[], board: readonly Card[], variant: Variant) {
  const hand = hole.map(card => ({ ...card })), community = board.map(card => ({ ...card }));
  const used = evaluateHand(hand, community, variant)?.cards ?? [];
  return { hole: hand.map(card => used.includes(card)), board: community.map(card => used.includes(card)) };
}

/** One selection per winning hand/run, so split pots never merge incompatible best fives. */
export function showdownSelections(state: VisibleState) {
  if (!state.summary) return [];
  const runs = state.summary.runs ?? [{ board: state.communityCards, revealed: state.summary.revealed,
    payouts: state.summary.awards ?? state.summary.payouts }];
  return runs.flatMap((run, index) => run.payouts.filter(p => p.amount > 0).map(p => {
    const hand = run.revealed.find(h => h.playerId === p.playerId);
    return { ...p, run: index, name: state.players.find(player => player.id === p.playerId)?.name ?? p.playerId,
      ranking: `${runs.length > 1 ? `${index + 1}本目 · ` : ''}${hand?.rankingName ?? '全員フォールド'}`,
      usedCards: hand?.usedCards ?? (hand ? evaluateHand(hand.holeCards, run.board, state.variant)?.cards ?? [] : []),
      positions: hand ? selectedPositions(hand.holeCards, run.board, state.variant) : { hole: [], board: [] },
    };
  }));
}
