import { useState, type ReactNode } from 'react';
import type { VisibleState } from '@wildcard/engine';
import { GameDialog } from './GameDialog.js';
import { HandSummaryPanel } from './HandSummaryPanel.js';
import { useActionLatch } from '../hooks/useActionLatch.js';
import { usePresentationTime } from '../hooks/usePresentationTime.js';

export function HandResultControl({ state, onNextHand, blockedReason, children, nextHandAt, onCancelNextHand }: {
  readonly state: VisibleState;
  readonly onNextHand: (() => void) | null;
  readonly blockedReason: string | null;
  readonly children: ReactNode;
  readonly nextHandAt: number | null;
  readonly onCancelNextHand: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const latch = useActionLatch(JSON.stringify([state.dealerSeat, state.summary]));
  const now = usePresentationTime(nextHandAt ?? 0);
  const seconds = nextHandAt === null ? null : Math.max(0, Math.ceil((nextHandAt - now) / 1000));
  const payouts = state.summary?.payouts.map(payout =>
    `${state.players.find(p => p.id === payout.playerId)?.name ?? payout.playerId} +${payout.amount.toLocaleString()}`,
  ).join(' / ');
  return (
    <div className="summary summary-compact">
      <div className="result-line"><strong title={payouts}>{payouts}</strong>
        {seconds !== null ? <span className="next-hand-countdown" role="timer">{seconds > 0 ? `次のハンドまで ${seconds}秒` : '配牌中…'}</span> : <span>ハンド終了</span>}
      </div>
      <div className="action-row">
        <button type="button" className="btn btn-muted" onClick={() => { onCancelNextHand?.(); setOpen(true); }}>結果の詳細</button>
        {onNextHand && (
          <button type="button" className="btn btn-primary" onClick={() => latch.run(onNextHand)} disabled={seconds === 0 || blockedReason !== null || !latch.enabled}>次のハンド</button>
        )}
        {onCancelNextHand && seconds !== null && seconds > 0 && <button type="button" className="btn btn-muted"
          aria-label="自動開始を停止" onClick={onCancelNextHand}>停止</button>}
      </div>
      {blockedReason && <p className="result-blocked">{blockedReason}</p>}
      {open && (
        <GameDialog title="ハンドの結果" onClose={() => setOpen(false)}>
          <HandSummaryPanel state={state} onNextHand={() => {}} canStartNextHand={false} blockedReason={null} showNextHand={false} />
          {children}
        </GameDialog>
      )}
    </div>
  );
}
