import type { ReactNode } from 'react';
import type { Action } from '@wildcard/engine';
import type { TableSnapshot } from '../transport/types.js';
import { ActionBar } from './ActionBar.js';
import { HandSummaryPanel } from './HandSummaryPanel.js';
import { PokerTable } from './PokerTable.js';

interface TableViewProps {
  readonly snapshot: TableSnapshot;
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly onExit: () => void;
  readonly onAction: (action: Action) => void;
  /**
   * この端末が操作してよいプレイヤー。null なら見ているだけ。
   *
   * ホットシートでは手番の人がそのまま入る（1台を回すので誰の番でも操作できる）。
   * オンラインでは自分の番のときだけ自分の id が入る。
   */
  readonly controllablePlayerId: string | null;
  /** ハンドを開始できる立場なら渡す。渡さなければボタンを出さない。 */
  readonly onStartHand: (() => void) | null;
  /** 開始できない理由。null なら開始できる。 */
  readonly startRejection: string | null;
  /** 卓の上に出す知らせ（接続状態など）。 */
  readonly banner: ReactNode;
}

/**
 * 卓の画面。ホットシートとオンラインで共通。
 *
 * Transport 越しに受け取ったスナップショットを描くだけで、通信しているのか
 * 同じタブでエンジンが回っているのかをここでは区別しない（原則3）。
 */
export function TableView({
  snapshot,
  title,
  subtitle,
  onExit,
  onAction,
  controllablePlayerId,
  onStartHand,
  startRejection,
  banner,
}: TableViewProps) {
  const { state, viewerId } = snapshot;
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const canAct = controllablePlayerId !== null && turnPlayer?.id === controllablePlayerId;

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-muted btn-small" onClick={onExit}>
          もどる
        </button>
        <span className="topbar-title">{title}</span>
        <span className="topbar-blinds">{subtitle}</span>
      </header>

      {banner}

      <main className="table-wrap">
        <PokerTable state={state} viewerId={viewerId} />
      </main>

      <footer className="bottombar">
        {state.phase === 'waiting' && onStartHand !== null && (
          <div className="centered-actions">
            <button
              type="button"
              className="btn btn-primary btn-large"
              onClick={onStartHand}
              disabled={startRejection !== null}
            >
              ゲーム開始
            </button>
            {startRejection !== null && <p className="hint">{startRejection}</p>}
          </div>
        )}

        {state.phase === 'waiting' && onStartHand === null && (
          <p className="hint centered-actions">host がハンドを開始するのを待っています。</p>
        )}

        {state.phase === 'showdown' && (
          <HandSummaryPanel
            state={state}
            onNextHand={onStartHand ?? (() => {})}
            canStartNextHand={onStartHand !== null && startRejection === null}
            blockedReason={
              onStartHand === null
                ? 'host が次のハンドを開始するのを待っています。'
                : startRejection
            }
          />
        )}

        {turnPlayer && (
          <>
            <div className="turn-label">{turnPlayer.name} の番</div>
            {canAct ? (
              <ActionBar state={state} playerId={turnPlayer.id} onAction={onAction} />
            ) : (
              <p className="hint centered-actions">相手の行動を待っています…</p>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
