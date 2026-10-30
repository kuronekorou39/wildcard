import { useEffect, useMemo, useRef, useState } from 'react';
import { type Action, decide, validate } from '@wildcard/engine';
import { TableView } from '../components/TableView.js';
import { useTable } from '../hooks/useTable.js';
import { LocalTransport } from '../transport/local.js';
import { resolveVariant } from '../rules/customVariants.js';
import { TABLE_TIMING } from '../transport/presentation.js';
import { cpuStyles } from '../cpuStyles.js';

export interface SoloSettings {
  readonly ante?: number;
  readonly name: string;
  readonly opponents: number;
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly variantId: string;
  /** CPU の attack 度。0 に近いほど慎重。 */
  readonly aggression: number;
  readonly mixedCpu?: boolean;
}

interface SoloTableProps {
  readonly settings: SoloSettings;
  readonly onExit: () => void;
}

const HUMAN_ID = 'you';
/** CPU が考えているように見せる間。短すぎると展開を追えない。 */
const THINK_MS = TABLE_TIMING.think;

/**
 * CPU を相手に一人で遊ぶ。
 *
 * 通信もサーバーも使わず、同じタブの中でエンジンが回っている（LocalTransport）。
 * CPU は勝率のモンテカルロ推定だけで打ち、役の名前も「AAは強い」といった知識も
 * 持たない。だからカードの強さや役の順位を差し替えても、そのまま相手になる。
 */
export function SoloTable({ settings, onExit }: SoloTableProps) {
  const [styleSeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]!);
  const styles = useMemo(() => cpuStyles(settings.opponents, styleSeed, settings.mixedCpu ? undefined : settings.aggression), [settings, styleSeed]);
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

    const variant = resolveVariant(settings.variantId);
    return new LocalTransport({
      paced: true, autoNextHandMs: TABLE_TIMING.nextHand,
      seatCount,
      smallBlind: settings.smallBlind,
      ante: settings.ante ?? 0,
      bigBlind: settings.bigBlind,
      ...(variant ? { variant } : {}),
      // 視点は自分に固定。CPU の手札は画面に出ない。
      viewer: { kind: 'fixed', playerId: HUMAN_ID },
      setup,
    });
  }, [settings]);

  const snapshot = useTable(transport);
  useEffect(() => { transport.resume(); return () => transport.dispose(); }, [transport]);
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
        aggression: styles[Number(turnId.replace('cpu', ''))]?.aggression ?? settings.aggression,
      });
      if (decision) transport.dispatch(decision.action);
      setThinking(null);
    }, Math.max(0, (snapshot.runtime?.readyAt ?? 0) - Date.now()) + THINK_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [transport, snapshot, cpuTurn, turnId, settings.aggression, styles]);

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
      subtitle={<><div>SB {settings.smallBlind} / BB {settings.bigBlind}</div><div className="cpu-style-list" aria-label="CPUのスタイル">{styles.map((style, i) => <span key={i}>CPU{i + 1} · {style.label}</span>)}</div></>}
      onExit={onExit}
      onAction={(action) => transport.dispatch(action)}
      // 操作できるのは自分の番だけ。CPU の番は見ているだけ。
      controllablePlayerId={turnId === HUMAN_ID ? HUMAN_ID : null}
      onStartHand={startHand}
      onCancelNextHand={() => transport.cancelNextHand()}
      startRejection={startRejection}
      banner={thinking !== null ? <div className="banner banner-wait">{thinking} が考えています…</div> : null}
    />
  );
}
