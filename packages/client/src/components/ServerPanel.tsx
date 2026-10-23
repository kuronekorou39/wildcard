import { useRef, useState } from 'react';
import { EditableNumber, TableStakes } from './EditableValue.js';
import { GameDialog } from './GameDialog.js';
import { resolveVariant } from '../rules/customVariants.js';
import { connectionToken, createServerTable, defaultServerUrl, invitedTable, loadConnection,
  normalizeServerUrl, saveConnection, saveServerUrl, serverRequest, tableIdFrom, type ServerSettings } from '../serverConnection.js';

export function ServerPanel({ variantId, role, onRoleChange, onStart }: {
  readonly variantId: string; readonly role: 'host' | 'guest';
  readonly onRoleChange: (role: 'host' | 'guest') => void;
  readonly onStart: (settings: ServerSettings) => void;
}) {
  const [server, setServer] = useState(defaultServerUrl);
  const [configOpen, setConfigOpen] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState(() => invitedTable() ?? '');
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [seats, setSeats] = useState(10);
  const [play, setPlay] = useState(true);
  const [createKey, setCreateKey] = useState(import.meta.env.DEV ? 'local-preview-only' : '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; settings: ServerSettings } | null>(null);
  const id = tableIdFrom(invite);
  const previous = server && id ? loadConnection(server, id) : null;
  const ready = !!server && (name.trim().length > 0 || !!previous) && (role === 'host' ? chips >= bigBlind && bigBlind >= smallBlind && smallBlind > 0 && !!createKey : !!id);
  const launch = async () => {
    if (busy) return;
    setBusy(true); setProblem(null);
    try {
      const serverUrl = normalizeServerUrl(server);
      saveServerUrl(serverUrl);
      let settings: ServerSettings;
      if (role === 'host') {
        const variant = resolveVariant(variantId);
        if (!variant) throw new Error('ルールが見つかりません');
        const options = { name: name.trim(), chips, smallBlind, bigBlind, seatCount: seats, hostPlays: play, variant };
        const signature = JSON.stringify([serverUrl, options]);
        if (attempt.current?.signature !== signature) attempt.current = { signature, settings: { serverUrl,
          tableId: crypto.randomUUID(), name: name.trim(), token: connectionToken() } };
        settings = attempt.current.settings;
        saveConnection(settings);
        await createServerTable(settings, options, createKey);
      } else {
        if (!id) throw new Error('招待リンクか卓IDを入力してください');
        settings = previous ?? { serverUrl, tableId: id, name: name.trim(), token: connectionToken() };
        saveConnection(settings);
        await serverRequest(settings, '/join', { method: 'POST', body: JSON.stringify({ token: settings.token, name: settings.name, play }) });
      }
      onStart(settings);
    } catch (failure) { setProblem(failure instanceof TypeError ? 'サーバーに接続できません。接続先と起動状態を確認してください' : (failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="session-config server-session">
    <div className="session-fields">
      <div className="segmented"><button type="button" className={`segment ${role === 'host' ? 'segment-active' : ''}`} onClick={() => onRoleChange('host')}>部屋を作る</button><button type="button" className={`segment ${role === 'guest' ? 'segment-active' : ''}`} onClick={() => onRoleChange('guest')}>参加する</button></div>
      <label className="field"><span className="field-label">あなたの名前</span><input className="input" value={name} maxLength={24} placeholder={previous?.name ?? '名前を入力'} onChange={event => setName(event.target.value)} /></label>
      {role === 'host' ? <><TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
        <div className="server-seats"><EditableNumber label="席数" value={seats} min={2} max={10} onChange={setSeats} /><label className="checkline"><input type="checkbox" checked={play} onChange={event => setPlay(event.target.checked)} />自分も席に着く</label></div></> : <>
        <label className="field"><span className="field-label">招待リンク / 卓ID</span><input className="input" value={invite} onChange={event => setInvite(event.target.value)} placeholder="招待リンクを貼り付け" /></label>
        {!previous && <label className="checkline"><input type="checkbox" checked={play} onChange={event => setPlay(event.target.checked)} />席に着く（オフで観戦）</label>}
      </>}
      {problem && <p className="hint hint-warn" role="alert">{problem}</p>}
    </div>
    <div className="session-launch"><button type="button" className="btn btn-primary btn-large btn-block" disabled={busy || !ready} onClick={() => { void launch(); }}>{busy ? '接続しています…' : role === 'host' ? '卓を作る' : previous ? '卓に戻る' : '参加する'}<span aria-hidden="true">→</span></button><button className="server-endpoint" type="button" aria-label="サーバー接続設定" title={server || '接続先を設定'} onClick={() => setConfigOpen(true)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 17h16M9 4v6M15 14v6" /></svg></button></div>
    {configOpen && <GameDialog title="サーバー接続" onClose={() => setConfigOpen(false)}>
      <label className="field"><span className="field-label">接続先URL</span><input className="input" defaultValue={server} placeholder="https://…" onBlur={event => { try { const url = normalizeServerUrl(event.target.value); setServer(url); saveServerUrl(url); setProblem(null); } catch (failure) { setProblem((failure as Error).message); } }} /></label>
      <label className="field"><span className="field-label">作成キー</span><input type="password" autoComplete="off" className="input" value={createKey} onChange={event => setCreateKey(event.target.value)} /></label>
      <p className="hint">検証用サーバーへの接続設定です。参加者には招待リンクを共有します。</p>
      <p className="hint">席への再接続情報はこのブラウザに保存します。別の端末では同じ席に戻れません。</p>
      {problem && <p className="hint hint-warn" role="alert">{problem}</p>}
    </GameDialog>}
  </div>;
}
