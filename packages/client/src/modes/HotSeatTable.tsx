import { useMemo, useRef, useState } from 'react';
import { type Action, validate } from '@wildcard/engine';
import { LocalTransport } from '../transport/local.js';
import { useTable } from '../hooks/useTable.js';
import { ActionBar } from '../components/ActionBar.js';
import { HandSummaryPanel } from '../components/HandSummaryPanel.js';
import { PassDeviceGate } from '../components/PassDeviceGate.js';
import { PokerTable } from '../components/PokerTable.js';

export interface HotSeatSettings {
  readonly names: readonly string[];
  readonly chips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
}

interface HotSeatTableProps {
  readonly settings: HotSeatSettings;
  readonly onExit: () => void;
}

/**
 * ホットシート（1台を回して遊ぶ）。
 *
 * サーバーは一切使わず、同じタブの中でエンジンが回っている。
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

    return new LocalTransport({
      seatCount,
      smallBlind: settings.smallBlind,
      bigBlind: settings.bigBlind,
      viewer: { kind: 'followTurn' },
      setup,
    });
  }, [settings]);

  const { state, viewerId } = useTable(transport);

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

  const startRejection = validate(transport.rawState(), { type: 'startHand', seed: 0 });
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);

  // 手番が移った直後は、本人が「見る」を押すまで卓を描かない。
  if (turnPlayer && revealedFor !== turnPlayer.id) {
    return (
      <PassDeviceGate playerName={turnPlayer.name} onReveal={() => setRevealedFor(turnPlayer.id)} />
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-muted btn-small" onClick={onExit}>
          もどる
        </button>
        <span className="topbar-title">ホットシート</span>
        <span className="topbar-blinds">
          SB {settings.smallBlind} / BB {settings.bigBlind}
        </span>
      </header>

      <main className="table-wrap">
        <PokerTable state={state} viewerId={viewerId} />
      </main>

      <footer className="bottombar">
        {state.phase === 'waiting' && (
          <div className="centered-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={startHand}
              disabled={startRejection !== null}
            >
              ゲーム開始
            </button>
            {startRejection && <p className="hint">{startRejection.reason}</p>}
          </div>
        )}

        {state.phase === 'showdown' && (
          <HandSummaryPanel
            state={state}
            onNextHand={startHand}
            canStartNextHand={startRejection === null}
            blockedReason={
              startRejection
                ? `次のハンドを開始できません: ${startRejection.reason}`
                : null
            }
          />
        )}

        {turnPlayer && (
          <>
            <div className="turn-label">{turnPlayer.name} の番</div>
            <ActionBar state={state} playerId={turnPlayer.id} onAction={act} />
          </>
        )}
      </footer>
    </div>
  );
}
