/**
 * 通信の診断ログ。
 *
 * P2P の不具合は「繋がらない」としか見えないことが多く、どこまで進んだのかが
 * 分からないと手が出ない。ICE 候補の種別、トラッカーの生死、offer/answer の
 * やりとりをここに溜めて、画面から見せられるようにしておく。
 */

export interface DiagEntry {
  readonly at: number;
  readonly tag: string;
  readonly detail: string;
}

const MAX_ENTRIES = 200;

const entries: DiagEntry[] = [];
const listeners = new Set<(entries: readonly DiagEntry[]) => void>();

export function diagLog(tag: string, detail: string): void {
  entries.push({ at: Date.now(), tag, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener(entries);
}

export function diagEntries(): readonly DiagEntry[] {
  return entries;
}

export function onDiag(listener: (entries: readonly DiagEntry[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearDiag(): void {
  entries.length = 0;
  for (const listener of listeners) listener(entries);
}
