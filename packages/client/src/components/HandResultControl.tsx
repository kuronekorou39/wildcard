import { useState, type ReactNode } from 'react';
import type { VisibleState } from '@wildcard/engine';
import { GameDialog } from './GameDialog.js';
import { HandSummaryPanel } from './HandSummaryPanel.js';

export function HandResultControl({ state, onNextHand, blockedReason, children }: {
  readonly state: VisibleState;
  readonly onNextHand: (() => void) | null;
  readonly blockedReason: string | null;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const payouts = state.summary?.payouts.map(payout =>
    `${state.players.find(p => p.id === payout.playerId)?.name ?? payout.playerId} +${payout.amount.toLocaleString()}`,
  ).join(' / ');
  return (
    <div className="summary summary-compact">
      <div className="result-line"><span>ハンド終了</span><strong title={payouts}>{payouts}</strong></div>
      <div className="action-row">
        <button type="button" className="btn btn-muted" onClick={() => setOpen(true)}>結果の詳細</button>
        {onNextHand && (
          <button type="button" className="btn btn-primary" onClick={onNextHand} disabled={blockedReason !== null}>次のハンド</button>
        )}
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
