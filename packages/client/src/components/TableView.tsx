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
import { useTableShape, useRunoutReveal } from '../tableAppearance.js';
import { useFoldReservation } from '../hooks/useFoldReservation.js';
import { ActionIcon } from './ActionIcon.js';
import { usePresentationTime } from '../hooks/usePresentationTime.js';

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
  readonly onCancelNextHand?: (() => void) | null;
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
  onCancelNextHand,
  startRejection,
  banner,
}: TableViewProps) {
  const { state, viewerId } = snapshot;
  const now = usePresentationTime(snapshot.runtime?.readyAt ?? 0);
  const presenting = now < (snapshot.runtime?.readyAt ?? 0);
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  const canAct = controllablePlayerId !== null && turnPlayer?.id === controllablePlayerId;
  const foldReservation = useFoldReservation(snapshot, presenting ? null : controllablePlayerId, onAction);
  const [infoOpen, setInfoOpen] = useState(false);
  const { shape, updateShape, saveFailed } = useTableShape();
  const runout = useRunoutReveal();
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
          revealRunout={runout.revealRunout} onRunoutChange={runout.updateRunout} runoutSaveFailed={runout.saveFailed}
          shapeSaveFailed={saveFailed} onClose={() => setInfoOpen(false)}
          notices={<>{banner}<DealNotice snapshot={snapshot} /></>} controls={extraControls} />
      )}

      <main className="table-wrap">
        <PokerTable state={state} viewerId={viewerId} shape={shape} runtime={snapshot.runtime ?? null} revealRunout={runout.revealRunout} />
      </main>

      <footer className="bottombar" data-active={canAct && !foldReservation.awaiting}>
        {(connectionProblem || dealNotice) && (
          <button className="table-notice-link" type="button" onClick={() => setInfoOpen(true)}>
            {connectionProblem ? snapshot.note ?? '接続状況を確認' : '配牌のお知らせ・露出札を確認'}
          </button>
        )}
        {state.phase === 'waiting' && onStartHand !== null && (
          <div className="centered-actions">
            <button
              type="button"
              className="btn table-command table-command-primary table-start"
              onClick={onStartHand}
              disabled={startRejection !== null}
            >
              <ActionIcon kind="play" /><span>ゲーム開始</span>
            </button>
            {startRejection !== null && <p className="hint">{startRejection}</p>}
          </div>
        )}

        {state.phase === 'waiting' && onStartHand === null && (
          <p className="hint centered-actions">host がハンドを開始するのを待っています。</p>
        )}

        {state.phase === 'showdown' && !presenting && (
          <HandResultControl
            state={state}
            onNextHand={onStartHand}
            nextHandAt={snapshot.runtime?.nextHandAt ?? null}
            onCancelNextHand={onCancelNextHand ?? null}
            blockedReason={
              onStartHand === null
                ? null
                : startRejection
            }
          >{extraControls}</HandResultControl>
        )}
        {state.phase === 'showdown' && snapshot.note && <p className="result-blocked" role="status">{snapshot.note}</p>}

        {turnPlayer && (
          <>
            {foldReservation.awaiting ? <span className="reservation-pending" role="status">送信中…</span> : canAct ? (
              state.phase === 'runChoice' ? (
                <RunChoiceBar state={state} playerId={turnPlayer.id} locked={presenting} turnId={snapshot.runtime?.clock?.id ?? 0} onAction={onAction} />
              ) : (
                <ActionBar state={state} playerId={turnPlayer.id} locked={presenting} turnId={snapshot.runtime?.clock?.id ?? 0} onAction={action => {
                  foldReservation.cancel();
                  onAction(action);
                }} />
              )
            ) : (
              <div className="waiting-turn">
                {foldReservation.canReserve && (
                  <button type="button" className="btn fold-reservation" aria-label="フォールド予約" aria-pressed={foldReservation.reserved}
                    onClick={foldReservation.toggle}>
                    <ActionIcon kind="fold" />
                    <span>フォールド<small>予約</small></span>
                    {foldReservation.reserved && <span className="reservation-check" aria-hidden="true">✓</span>}
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
