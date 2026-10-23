import { useEffect, useMemo, useState } from 'react';
import type { SavedHand } from '@wildcard/table';
import { TableView } from '../components/TableView.js';
import { GameDialog } from '../components/GameDialog.js';
import { HandSummaryPanel } from '../components/HandSummaryPanel.js';
import { useTable } from '../hooks/useTable.js';
import { ServerTransport } from '../transport/server.js';
import { inviteLink, serverRequest, type ServerSettings } from '../serverConnection.js';

interface HistoryItem { readonly handId: number; readonly endedAt: number; readonly winners: readonly { name: string; amount: number }[] }

export function ServerTable({ settings, onExit }: { readonly settings: ServerSettings; readonly onExit: () => void }) {
  const transport = useMemo(() => new ServerTransport(settings), [settings]);
  const snapshot = useTable(transport);
  const remote = transport.serverSnapshot();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  useEffect(() => { transport.start(); return () => transport.stop(); }, [transport]);
  const connected = snapshot.status === 'connected';
  const canControl = connected && !snapshot.pending && !remote?.closed;
  const myTurn = canControl && snapshot.viewerId === snapshot.state.turnPlayerId ? snapshot.viewerId : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(inviteLink(settings.tableId)); setCopied(true); }
    catch { setCopied(false); }
  };
  return <>
    <TableView snapshot={snapshot} title="オンライン" subtitle={<div className="server-invite">
      <button className="btn btn-small" type="button" onClick={() => { void copy(); }}>{copied ? 'コピーしました' : '招待リンクをコピー'}</button>
      <input className="input" readOnly aria-label="招待リンク" value={inviteLink(settings.tableId)} onFocus={event => event.target.select()} />
    </div>} onExit={onExit} onAction={action => transport.dispatch(action)} controllablePlayerId={myTurn}
      onStartHand={remote?.owner && !remote.closed ? () => transport.send({ type: 'start' }) : null}
      onCancelNextHand={remote?.owner && !remote.closed ? () => transport.send({ type: 'pause' }) : null}
      startRejection={!canControl ? remote?.closed ? 'この卓は終了しました' : '接続・送信を待っています' : remote?.startRejection ?? null}
      banner={<div className="server-table-controls">
        {snapshot.note && <p role="status" className="hint hint-warn">{snapshot.note}</p>}
        <p className="hint">{remote?.closed ? '終了した卓です。保存したハンドを確認できます。' : `接続中 ${remote?.online.length ?? 0} 人`}</p>
        <button type="button" className="btn" disabled={!connected} onClick={() => setHistoryOpen(true)}>保存したハンド</button>
        {snapshot.viewerId && !remote?.closed && <button type="button" className="btn" disabled={!canControl}
          onClick={() => transport.send({ type: 'setAway', away: !snapshot.state.players.find(player => player.id === snapshot.viewerId)?.away })}>
          {snapshot.state.players.find(player => player.id === snapshot.viewerId)?.away ? '席に戻る' : '離席する'}</button>}
        {remote?.owner && !remote.closed && <button type="button" className="btn" disabled={!canControl || !['waiting', 'showdown'].includes(snapshot.state.phase)} onClick={() => setCloseConfirm(true)}>卓を終了</button>}
      </div>} />
    {historyOpen && <HistoryDialog settings={settings} onClose={() => setHistoryOpen(false)} />}
    {closeConfirm && <GameDialog title="卓を終了" onClose={() => setCloseConfirm(false)}><p>次のハンドを止め、この卓への新しい参加を締め切ります。記録は保存期間内に確認できます。</p><button type="button" className="btn btn-danger" onClick={() => { transport.send({ type: 'close' }); setCloseConfirm(false); }}>卓を終了する</button></GameDialog>}
  </>;
}

function HistoryDialog({ settings, onClose }: { readonly settings: ServerSettings; readonly onClose: () => void }) {
  const [hands, setHands] = useState<readonly HistoryItem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [record, setRecord] = useState<SavedHand | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setProblem(null); setRecord(null);
    void serverRequest(settings, selected === null ? '/history' : `/history/${selected}`, { signal: controller.signal })
      .then(value => { if (selected === null) setHands((value as { hands: HistoryItem[] }).hands); else setRecord(value as SavedHand); })
      .catch(failure => { if (!controller.signal.aborted) setProblem((failure as Error).message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [settings, selected]);
  return <GameDialog title={selected === null ? '保存したハンド' : `ハンド #${selected}`} onClose={onClose} className="server-history-dialog">
    {selected !== null && <button type="button" className="btn btn-small" onClick={() => setSelected(null)}>一覧へ戻る</button>}
    {loading ? <p className="hint" role="status">読み込んでいます…</p> : problem ? <p className="hint hint-warn" role="alert">{problem}</p> : record ?
      <HandSummaryPanel state={record.state} onNextHand={() => {}} canStartNextHand={false} blockedReason={null} showNextHand={false} /> :
      hands.length ? <ol className="server-history-list">{hands.map(hand => <li key={hand.handId}><button type="button" onClick={() => setSelected(hand.handId)}>
        <strong>#{hand.handId}</strong><span>{hand.winners.map(winner => `${winner.name} +${winner.amount.toLocaleString()}`).join(' / ')}<small>{new Date(hand.endedAt).toLocaleString('ja-JP')}</small></span><span aria-hidden="true">→</span>
      </button></li>)}</ol> : <p className="hint">終了したハンドがここに残ります。</p>}
  </GameDialog>;
}
