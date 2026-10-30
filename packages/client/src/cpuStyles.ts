import { shuffle } from '@wildcard/engine';

export const CPU_STYLES = [
  { aggression: .15, label: '慎重' },
  { aggression: .5, label: '標準' },
  { aggression: .85, label: '強気' },
] as const;

/** Balanced, deterministic personalities, assigned once for the lifetime of a table. */
export function cpuStyles(count: number, seed: number, uniform?: number) {
  if (uniform !== undefined) return Array.from({ length: count }, () => ({ aggression: uniform,
    label: CPU_STYLES.find(style => style.aggression === uniform)?.label ?? '標準' }));
  const palette = shuffle(CPU_STYLES, seed);
  return shuffle(Array.from({ length: count }, (_, i) => palette[i % palette.length]!), seed ^ 0x75ef13);
}
