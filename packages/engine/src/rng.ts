/**
 * seed 固定の疑似乱数。
 *
 * エンジンが乱数の副作用を持たないための要（原則1）。
 * 同じ seed からは必ず同じ配牌が得られるので、不具合のあったハンドを
 * seed だけで完全に再現してテストに落とせる。
 *
 * mulberry32 — 32bit seed、周期 2^32。暗号用途ではない。
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reads externally supplied random uint32 words without generating randomness in the engine.
 * Servers supply Web Crypto words; tests can replay the same tape. Never transmitted to players.
 */
export function entropySource(words: readonly number[]) {
  let cursor = 0;
  const word = () => {
    const value = words[cursor++];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('配牌用の乱数が不足または不正です');
    }
    return value;
  };
  return {
    next: () => word() / 0x100000000,
    index: (bound: number) => {
      if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) throw new Error('乱数の範囲が不正です');
      const limit = Math.floor(0x100000000 / bound) * bound;
      let value: number;
      do { value = word(); } while (value >= limit);
      return value % bound;
    },
  };
}
