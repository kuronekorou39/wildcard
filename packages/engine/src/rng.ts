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
