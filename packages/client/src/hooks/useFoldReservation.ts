import { useEffect, useRef, useState } from 'react';
import { legalActions, type Action } from '@wildcard/engine';
import type { TableSnapshot } from '../transport/types.js';

/** 予約はこの端末だけに保持し、本人の手番になってから通常のアクションを送る。 */
export function useFoldReservation(snapshot: TableSnapshot, controllablePlayerId: string | null, onAction: (action: Action) => void) {
  const { state, viewerId, status } = snapshot;
  const player = state.players.find(p => p.id === viewerId);
  const eligible = (status === 'local' || status === 'connected') && state.phase === 'betting'
    && !!player && player.inHand && !player.folded && !player.allIn && !player.away;
  // 配牌・視点が変わった予約を次のハンドや別の人へ持ち越さない。
  const handKey = JSON.stringify([viewerId, state.dealerSeat, player?.holeCards]);
  const pending = useRef<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const canReserve = eligible && state.turnPlayerId !== viewerId;
  const reserved = eligible && selected === handKey;
  const cancel = () => { pending.current = null; setSelected(null); };

  useEffect(() => {
    if (!eligible || pending.current !== handKey) {
      pending.current = null;
      setSelected(null);
      return;
    }
    if (viewerId !== null && controllablePlayerId === viewerId && legalActions(state, viewerId)?.canFold) {
      // 通信の応答待ちや StrictMode の再実行でも二重送信しない。
      pending.current = null;
      setSelected(null);
      onAction({ type: 'fold', playerId: viewerId });
    }
  }, [eligible, handKey, viewerId, controllablePlayerId, state, onAction]);

  return {
    canReserve, reserved, cancel,
    toggle: () => {
      if (!canReserve) return;
      pending.current = pending.current === handKey ? null : handKey;
      setSelected(pending.current);
    },
  };
}
