/** Shared timing for the authority, CPU and visual timeline (milliseconds). */
export const TABLE_TIMING = {
  card: 680, dealGap: 44, dealReveal: 360, boardGap: 180,
  bet: 900, collect: 1000, collectPause: 350, win: 1300, streetPause: 650, showdownPause: 1000,
  think: 1400, nextHand: 8000, history: 60000,
} as const;

export interface ChipStack { readonly value: number; readonly count: number }
export interface PostedBet { readonly playerId: string; readonly chips: readonly ChipStack[] }
export const CHIP_VALUES = [1000, 100, 10, 1] as const;

/** Break down each contribution once. Never exchange chips already in the pot. */
export function contributedChips(amount: number): ChipStack[] {
  let remaining = amount;
  return CHIP_VALUES.map(value => {
    const count = Math.floor(remaining / value);
    remaining -= count * value;
    return { value, count };
  }).filter(stack => stack.count > 0);
}
export function addChips(pot: readonly ChipStack[], contribution: readonly ChipStack[]): ChipStack[] {
  return CHIP_VALUES.map(value => ({ value, count: [...pot, ...contribution]
    .filter(stack => stack.value === value).reduce((sum, stack) => sum + stack.count, 0) }))
    .filter(stack => stack.count > 0);
}
export const chipsTotal = (chips: readonly ChipStack[]) => chips.reduce((sum, stack) => sum + stack.value * stack.count, 0);

export function subtractChips(chips: readonly ChipStack[], removed: readonly ChipStack[]): ChipStack[] {
  return chips.map(stack => ({ ...stack, count: Math.max(0, stack.count - removed.filter(c => c.value === stack.value).reduce((n, c) => n + c.count, 0)) }))
    .filter(stack => stack.count > 0);
}
