import { useEffect, useMemo, useRef, useState } from 'react';
import { type Action, decide, findVariant, validate } from '@wildcard/engine';
import { TableView } from '../components/TableView.js';
import { useTable } from '../hooks/useTable.js';
import { LocalTransport } from '../transport/local.js';

export interface SoloSettings {
  readonly name: string;
  readonly opponents: number;
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly variantId: string;
  /** CPU の attack 度。0 に近いほど慎重。 */
  readonly aggression: number;
}

interface SoloTableProps {
  readonly settings: SoloSettings;
  readonly onExit: () => void;
}

const HUMAN_ID = 'you';
/** CPU が考えているように見せる間。短すぎると展開を追えない。 */
const THINK_MS = 700;

/**
 * CPU を相手に一人で遊ぶ。
 *
 * 通信もサーバーも使わず、同じタブの中でエンジンが回っている（LocalTransport）。
 * CPU は勝率のモンテカルロ推定だけで打ち、役の名前も「AAは強い」といった知識も
 * 持たない。だからカードの強さや役の順位を差し替えても、そのまま相手になる。
 */
export function SoloTable({ settings, onExit }: SoloTableProps) {
  const transport = useMemo(() => {
    const seatCount = settings.opponents + 1;
    const setup: Action[] = [
      {
        type: 'sit',
        playerId: HUMAN_ID,
        name: settings.name.trim() || 'あなた',
        seat: 0,
        chips: settings.chips,
      },
      ...Array.from({ length: settings.opponents }, (_, i): Action => ({
        type: 'sit',
        playerId: `cpu${i}`,
        name: `CPU${i + 1}`,
        seat: i + 1,
        chips: settings.chips,
      })),
    ];

    const variant = findVariant(settings.variantId);
    return new LocalTransport({
      seatCount,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      ...(variant ? { variant } : {}),
      // 視点は自分に固定。CPU の手札は画面に出ない。
      viewer: { kind: 'fixed', playerId: HUMAN_ID },
      setup,
    });
  }, [settings]);

  const snapshot = useTable(transport);
  const handCounter = useRef(0);
  const decisionSeed = useRef(1);
  const [thinking, setThinking] = useState<string | null>(null);

  const turnId = snapshot.state.turnPlayerId;
  const cpuTurn = turnId !== null && turnId !== HUMAN_ID;

  // CPU の手番が来たら、少し待ってから打たせる。
  useEffect(() => {
    if (!cpuTurn || turnId === null) {
      setThinking(null);
      return;
    }

    const name = snapshot.state.players.find((p) => p.id === turnId)?.name ?? 'CPU';
    setThinking(name);

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // decide が見るのは自分の手札と場のカードだけ。相手の手札は渡らない。
      const decision = decide(transport.rawState(), turnId, decisionSeed.current++, {
        aggression: settings.aggression,
      });
      if (decision) transport.dispatch(decision.action);
      setThinking(null);
    }, THINK_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [transport, snapshot, cpuTurn, turnId, settings.aggression]);

  const startHand = () => {
    handCounter.current += 1;
    const seed = (Date.now() ^ (handCounter.current * 2654435761)) >>> 0;
    transport.dispatch({ type: 'startHand', seed });
  };

  const startRejection =
    validate(transport.rawState(), { type: 'startHand', seed: 0 })?.reason ?? null;

  return (
    <TableView
      snapshot={snapshot}
      title="ソロ（CPU相手）"
      subtitle={`SB ${settings.smallBlind} / BB ${settings.bigBlind}`}
      onExit={onExit}
      onAction={(action) => transport.dispatch(action)}
      // 操作できるのは自分の番だけ。CPU の番は見ているだけ。
      controllablePlayerId={turnId === HUMAN_ID ? HUMAN_ID : null}
      onStartHand={startHand}
      startRejection={startRejection}
      banner={thinking !== null ? <div className="banner banner-wait">{thinking} が考えています…</div> : null}
      variantId={settings.variantId}
    />
  );
}
