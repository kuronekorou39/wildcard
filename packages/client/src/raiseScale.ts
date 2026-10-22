/** Spend half the slider travel on common small bets, without changing legal limits. */
export function raiseScale(min: number, max: number, bigBlind: number) {
  const middle = Math.min(min + (max - min) / 2, Math.max(bigBlind * 10, min * 2));
  const clamp = (amount: number) => Math.max(min, Math.min(max, Math.round(amount)));
  return {
    middle: Math.round(middle),
    amountAt(position: number) {
      const p = Math.max(0, Math.min(1000, position)) / 1000;
      return clamp(p <= .5 ? min + (middle - min) * p * 2 : middle + (max - middle) * (p - .5) * 2);
    },
    positionOf(amount: number) {
      if (max <= min) return 0;
      const value = clamp(amount);
      return value <= middle ? (value - min) / (middle - min) * 500 : 500 + (value - middle) / (max - middle) * 500;
    },
  };
}
