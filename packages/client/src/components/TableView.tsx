import type { ReactNode } from 'react';
import type { Action } from '@wildcard/engine';
import type { TableSnapshot } from '../transport/types.js';
import { ActionBar } from './ActionBar.js';
import { RunChoiceBar } from './RunChoiceBar.js';
import { RuleSheet } from './RulePicker.js';
import { ShowCardsControl } from './ShowCardsControl.js';
import { StraddleControl } from './StraddleControl.js';
import { HandSummaryPanel } from './HandSummaryPanel.js';
import { PlayingCard } from './PlayingCard.js';
import { PokerTable } from './PokerTable.js';
import { Brand } from './Brand.js';
import { CardAppearancePicker } from './CardAppearancePicker.js';

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
    <div className="screen screen-game">
      <header className="topbar">
        <button type="button" className="btn btn-muted btn-small" onClick={onExit}>
          もどる
        </button>
        <Brand compact />
        <span className="topbar-title">{title}</span>
        <span className="topbar-blinds">{subtitle}</span>
      </header>

      <div className="rule-bar">
        <RuleSheet variant={snapshot.state.variant} />
        <CardAppearancePicker />
      </div>

      {banner}
      <DealNotice snapshot={snapshot} />

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

        <ShowCardsControl state={state} viewerId={viewerId} onAction={onAction} />
        <StraddleControl state={state} viewerId={viewerId} onAction={onAction} />

        {turnPlayer && (
          <>
            <div className="turn-label">
              {state.phase === 'runChoice'
                ? `${turnPlayer.name} に聞いています`
                : `${turnPlayer.name} の番`}
            </div>
            {canAct ? (
              state.phase === 'runChoice' ? (
                <RunChoiceBar state={state} playerId={turnPlayer.id} onAction={onAction} />
              ) : (
                <ActionBar state={state} playerId={turnPlayer.id} onAction={onAction} />
              )
            ) : (
              <p className="hint centered-actions">相手の行動を待っています…</p>
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
