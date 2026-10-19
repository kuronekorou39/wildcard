import { useCallback, useSyncExternalStore } from 'react';
import type { TableSnapshot, Transport } from '../transport/types.js';

/**
 * Transport の状態を React に繋ぐ。
 *
 * 第3引数はサーバー描画時の値。Transport の状態は最初から確定しているので
 * getSnapshot と同じものを渡す。これが無いと renderToString が例外を投げ、
 * コンポーネントの描画テストが書けない。
 */
export function useTable(transport: Transport): TableSnapshot {
  const getSnapshot = useCallback(() => transport.snapshot(), [transport]);
  return useSyncExternalStore(
    useCallback((onChange: () => void) => transport.subscribe(onChange), [transport]),
    getSnapshot,
    getSnapshot,
  );
}
