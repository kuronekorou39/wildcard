import { useRef, useState } from 'react';
import { EditableNumber, TableStakes } from './EditableValue.js';
import { GameDialog } from './GameDialog.js';
import { Icon } from './Icon.js';
import { resolveVariant } from '../rules/customVariants.js';
import { connectionToken, createServerTable, defaultServerUrl, invitedTable, loadConnection,
  saveConnection, serverRequest, tableIdFrom, UNREACHABLE_SERVER, type ServerSettings } from '../serverConnection.js';

export function ServerPanel({ variantId, name, role, onRoleChange, onStart }: {
  readonly variantId: string; readonly name: string; readonly role: 'host' | 'guest';
  readonly onRoleChange: (role: 'host' | 'guest') => void;
  readonly onStart: (settings: ServerSettings) => void;
}) {
  // 接続先は配布時の設定で決まり、画面には出さない。参加者に必要なのは招待リンクだけ、作成者は作成キーだけ。
  const server = defaultServerUrl();
  const [configOpen, setConfigOpen] = useState(false);
  const [invite, setInvite] = useState(() => invitedTable() ?? '');
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [ante, setAnte] = useState(0);
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
      const serverUrl = server;
      let settings: ServerSettings;
      if (role === 'host') {
        const variant = resolveVariant(variantId);
        if (!variant) throw new Error('ルールが見つかりません');
        const options = { name: name.trim(), chips, smallBlind, bigBlind, ante, seatCount: seats, hostPlays: play, variant };
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
    } catch (failure) { setProblem(failure instanceof TypeError ? UNREACHABLE_SERVER : (failure as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="session-config server-session">
    <div className="session-fields">
      <div className="segmented"><button type="button" className={`segment ${role === 'host' ? 'segment-active' : ''}`} onClick={() => onRoleChange('host')}>部屋を作る</button><button type="button" className={`segment ${role === 'guest' ? 'segment-active' : ''}`} onClick={() => onRoleChange('guest')}>参加する</button></div>
      {role === 'host' ? <><TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} ante={ante} onAnte={setAnte} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
        <div className="server-seats"><EditableNumber label="席数" value={seats} min={2} max={10} onChange={setSeats} /><label className="checkline"><input type="checkbox" checked={play} onChange={event => setPlay(event.target.checked)} />自分も席に着く</label></div></> : <>
        <label className="field"><span className="field-label">招待リンク / 卓ID</span><input className="input" value={invite} onChange={event => setInvite(event.target.value)} placeholder="招待リンクを貼り付け" /></label>
        {!previous && <label className="checkline"><input type="checkbox" checked={play} onChange={event => setPlay(event.target.checked)} />席に着く（オフで観戦）</label>}
      </>}
      {problem && <p className="hint hint-warn" role="alert">{problem}</p>}
    </div>
    <div className="session-launch">
      {role === 'host'
        ? <button className="server-endpoint" type="button" aria-label="作成キーの設定" onClick={() => setConfigOpen(true)}><span>作成キー <Icon kind="external" /></span><small>{!server ? 'サーバー未設定' : createKey ? '入力済み' : '管理者から受け取ったキーが必要'}</small></button>
        : <p className="server-endpoint server-endpoint-note"><span>招待リンクで参加</span><small>{!server ? 'サーバー未設定' : 'キー不要'}</small></p>}
      <button type="button" className="btn btn-primary btn-large btn-block" disabled={busy || !ready} onClick={() => { void launch(); }}>{busy ? '接続しています…' : role === 'host' ? '卓を作る' : previous ? '卓に戻る' : '参加する'}<Icon kind="arrow-right" /></button>
    </div>
    {configOpen && <GameDialog title="作成キーの設定" className="server-connection-dialog" onClose={() => setConfigOpen(false)}>
      <p className="server-access-note">卓を作るときだけ必要です。参加者は招待リンクだけで入れます。</p>
      <label className="field"><span className="field-label">作成キー</span><input aria-label="作成キー" type="password" autoComplete="off" className="input" value={createKey} onChange={event => setCreateKey(event.target.value)} /><span className="hint">管理者から受け取ったキーを入力</span></label>
      <p className="hint">同じ席への復帰は、このブラウザから。</p>
      {problem && <p className="hint hint-warn" role="alert">{problem}</p>}
    </GameDialog>}
  </div>;
}
