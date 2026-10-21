import { useEffect, useMemo, useRef, useState } from 'react';
import { type Action, validate } from '@wildcard/engine';
import { LocalTransport } from '../transport/local.js';
import { useTable } from '../hooks/useTable.js';
import { PassDeviceGate } from '../components/PassDeviceGate.js';
import { TableView } from '../components/TableView.js';
import { resolveVariant } from '../rules/customVariants.js';
import { TABLE_TIMING } from '../transport/presentation.js';

export interface HotSeatSettings {
  readonly names: readonly string[];
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly variantId: string;
}

interface HotSeatTableProps {
  readonly settings: HotSeatSettings;
  readonly onExit: () => void;
}

/**
 * ホットシート（1台を回して遊ぶ）。
 *
 * サーバーも通信も使わず、同じタブの中でエンジンが回っている。
 * 視点は手番とともに動き（LocalTransport の followTurn）、手番が移るたびに
 * 目隠しを挟むことで、1台でもホールカードの秘匿が成立する。
 */
export function HotSeatTable({ settings, onExit }: HotSeatTableProps) {
  const transport = useMemo(() => {
    const seatCount = Math.max(settings.names.length, 2);
    const setup: Action[] = settings.names.map((name, i) => ({
      type: 'sit' as const,
      playerId: `p${i}`,
      name: name.trim() || `プレイヤー${i + 1}`,
      seat: i,
      chips: settings.chips,
    }));

    const variant = resolveVariant(settings.variantId);
    return new LocalTransport({
      paced: true, autoNextHandMs: TABLE_TIMING.nextHand,
      seatCount,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ...(variant ? { variant } : {}),
      viewer: { kind: 'followTurn' },
      setup,
    });
  }, [settings]);

  const snapshot = useTable(transport);
  useEffect(() => { transport.resume(); return () => transport.dispose(); }, [transport]);

  /** 今カードを見せてよい相手。手番が移ると食い違い、目隠しが入る。 */
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const handCounter = useRef(0);

  const startHand = () => {
    handCounter.current += 1;
    // seed は外から与える。エンジンは乱数を持たない（原則1）。
    const seed = (Date.now() ^ (handCounter.current * 2654435761)) >>> 0;
    transport.dispatch({ type: 'startHand', seed });
    setRevealedFor(null);
  };

  const act = (action: Action) => {
    transport.dispatch(action);
    setRevealedFor(null);
  };

  const startRejection =
    validate(transport.rawState(), { type: 'startHand', seed: 0 })?.reason ?? null;
  const turnPlayer = snapshot.state.players.find((p) => p.id === snapshot.state.turnPlayerId);
  const revealKey = `${snapshot.runtime?.handId}:${snapshot.runtime?.clock?.id}:${turnPlayer?.id}`;

  // 手番が移った直後は、本人が「見る」を押すまで卓を描かない。
  // オーバーレイで覆うだけだと DOM に次の人のホールカードが載ってしまう。
  if (turnPlayer && revealedFor !== revealKey) {
    return (
      <PassDeviceGate playerName={turnPlayer.name} onReveal={() => {
        setRevealedFor(revealKey);
        transport.revealTurn();
      }} />
    );
  }

  return (
    <TableView
      snapshot={snapshot}
      title="ホットシート"
      subtitle={`SB ${settings.smallBlind} / BB ${settings.bigBlind}`}
      onExit={onExit}
      onAction={act}
      // 1台を回しているので、手番の人は誰でも操作できる。
      controllablePlayerId={snapshot.state.turnPlayerId}
      onStartHand={startHand}
      onCancelNextHand={() => transport.cancelNextHand()}
      startRejection={startRejection}
      banner={null}
    />
  );
}
