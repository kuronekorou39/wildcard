import { useState, type ReactNode } from 'react';
import type { Action } from '@wildcard/engine';
import type { TableSnapshot } from '../transport/types.js';
import { ActionBar } from './ActionBar.js';
import { RunChoiceBar } from './RunChoiceBar.js';
import { ShowCardsControl } from './ShowCardsControl.js';
import { StraddleControl } from './StraddleControl.js';
import { HandResultControl } from './HandResultControl.js';
import { PlayingCard } from './PlayingCard.js';
import { PokerTable } from './PokerTable.js';
import { TableInfoPanel } from './TableInfoPanel.js';
import { useTableShape } from '../tableAppearance.js';
import { useFoldReservation } from '../hooks/useFoldReservation.js';

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
  const foldReservation = useFoldReservation(snapshot, controllablePlayerId, onAction);
  const [infoOpen, setInfoOpen] = useState(false);
  const { shape, updateShape, saveFailed } = useTableShape();
  const connectionProblem = !['local', 'connected'].includes(snapshot.status);
  const dealNotice = state.phase !== 'waiting' && (state.exposedCards.length > 0 || state.misdeals > 0);
  const extraControls = <>
    <ShowCardsControl state={state} viewerId={viewerId} onAction={onAction} />
    <StraddleControl state={state} viewerId={viewerId} onAction={onAction} />
  </>;

  return (
    <div className="screen screen-game" data-phase={state.phase}>
      <button type="button" className="btn game-corner game-back" onClick={onExit} aria-label="もどる">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6M8 12h13" /></svg>
      </button>
      <button type="button" className="btn game-corner game-info" onClick={() => setInfoOpen(true)}
        aria-label="卓の情報" aria-haspopup="dialog" aria-expanded={infoOpen}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>
        {(connectionProblem || dealNotice) && <span className="info-alert-dot" />}
      </button>
      {infoOpen && (
        <TableInfoPanel state={state} title={title} subtitle={subtitle} shape={shape} onShapeChange={updateShape}
          shapeSaveFailed={saveFailed} onClose={() => setInfoOpen(false)}
          notices={<>{banner}<DealNotice snapshot={snapshot} /></>} controls={extraControls} />
      )}

      <main className="table-wrap">
        <PokerTable state={state} viewerId={viewerId} shape={shape} />
      </main>

      <footer className="bottombar">
        {(connectionProblem || dealNotice) && (
          <button className="table-notice-link" type="button" onClick={() => setInfoOpen(true)}>
            {connectionProblem ? snapshot.note ?? '接続状況を確認' : '配牌のお知らせ・露出札を確認'}
          </button>
        )}
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
          <HandResultControl
            state={state}
            onNextHand={onStartHand}
            blockedReason={
              onStartHand === null
                ? 'host が次のハンドを開始するのを待っています。'
                : startRejection
            }
          >{extraControls}</HandResultControl>
        )}

        {turnPlayer && (
          <>
            <div className="turn-label">
              {snapshot.status !== 'local' && <span className="table-host-label">{title} · </span>}
              {state.phase === 'runChoice'
                ? `${turnPlayer.name} に聞いています`
                : `${turnPlayer.name} の番`}
            </div>
            {canAct ? (
              state.phase === 'runChoice' ? (
                <RunChoiceBar state={state} playerId={turnPlayer.id} onAction={onAction} />
              ) : (
                <ActionBar state={state} playerId={turnPlayer.id} onAction={action => {
                  foldReservation.cancel();
                  onAction(action);
                }} />
              )
            ) : (
              <div className="waiting-turn">
                <div className="waiting-actions" role="status">
                  <span className="waiting-pulse" />
                  {foldReservation.reserved ? '自分の番でフォールドします' : '相手の行動を待っています…'}
                </div>
                {foldReservation.canReserve && (
                  <button type="button" className="btn fold-reservation" aria-pressed={foldReservation.reserved}
                    onClick={foldReservation.toggle}>
                    <span className="reservation-check" aria-hidden="true">{foldReservation.reserved ? '✓' : ''}</span>
                    <span>フォールド予約<small>{foldReservation.reserved ? 'オン · もう一度押すと解除' : 'オフ · 手番が来たら実行'}</small></span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </footer>
    </div>
  );
}

/**
 * ディーラーが札を表にしてしまったときの告知。
 *
 * 不具合に見えるおそれがあるので、起きたことと**どう処理したか**を必ず出す。
 * 実際の手順どおり、1枚なら回収して引き直し（手札は公開されない）、
 * その札はフロップのバーンに使われる。2枚以上なら配り直し。
 */
function DealNotice({ snapshot }: { readonly snapshot: TableSnapshot }) {
  const { state } = snapshot;
  if (state.phase === 'waiting') return null;
  if (state.exposedCards.length === 0 && state.misdeals === 0) return null;

  return (
    <div className="banner banner-warn deal-notice">
      {state.misdeals > 0 && (
        <span>ミスディールで{state.misdeals}回配り直しました。</span>
      )}
      {state.exposedCards.length > 0 && (
        <span className="deal-notice-exposed">
          ディーラーが表にしてしまった札:
          <span className="deal-notice-cards">
            {state.exposedCards.map((card, i) => (
              <PlayingCard key={i} card={card} size="sm" />
            ))}
          </span>
          回収して引き直したので手札は割れていません。この札はもう出ません。
        </span>
      )}
    </div>
  );
}
