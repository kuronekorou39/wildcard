import { useRef, useState } from 'react';
import type { OnlineSettings } from '../modes/OnlineTable.js';
import type { SoloSettings } from '../modes/SoloTable.js';
import { SoloPanel } from './SoloPanel.js';
import { RulePicker } from './RulePicker.js';
import { Brand } from './Brand.js';
import { Icon } from './Icon.js';
import { EditableText, TableStakes } from './EditableValue.js';
import { GameDialog } from './GameDialog.js';
import { ROOM_CODE_LENGTH, createRoomCode, invalidRoomCodeChars, isValidRoomCode, normalizeRoomCode } from '../room.js';
import { ServerPanel } from './ServerPanel.js';
import { invitedTable, type ServerSettings } from '../serverConnection.js';
import { PLAYER_NAME_MAX, loadPlayerName, savePlayerName } from '../playerName.js';

export type SetupMode = 'online' | 'solo';
interface SetupScreenProps {
  readonly variantId: string;
  readonly onVariantChange: (id: string) => void;
  readonly onEditRules: (id: string) => void;
  readonly mode: SetupMode;
  readonly onModeChange: (mode: SetupMode) => void;
  readonly onStartOnline: (settings: OnlineSettings) => void;
  readonly onStartServer: (settings: ServerSettings) => void;
  readonly onStartSolo: (settings: SoloSettings) => void;
}

export function SetupScreen({ mode, onModeChange, variantId, onVariantChange, onEditRules, onStartOnline, onStartServer, onStartSolo }: SetupScreenProps) {
  const [onlineRole, setOnlineRole] = useState<'host' | 'guest'>(() => invitedTable() ? 'guest' : 'host');
  const [connection, setConnection] = useState<'server' | 'p2p'>(() => invitedTable() ? 'server' : 'p2p');
  const [about, setAbout] = useState(false);
  const aboutTrigger = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  // 名前はモードをまたいで1つ。どこで直してもどこでも使う。
  const [name, setName] = useState(loadPlayerName);
  const changeName = (value: string) => { setName(value); savePlayerName(value); };
  return <div className="screen screen-setup setup-shell">
    <header ref={header} className="setup-header"><Brand /><button ref={aboutTrigger} type="button" className="preview-badge" aria-haspopup="dialog" aria-expanded={about} onClick={() => setAbout(true)}>PREVIEW <Icon kind="info" /></button></header>
    <main className="setup-desk">
      <section className="setup-rule-pane" aria-label="ルールの設定">
        {mode === 'online' && onlineRole === 'guest' ? <div className="join-context"><span aria-hidden="true"><Icon kind="external" /></span><h2>{connection === 'server' ? '招待リンクで参加' : 'ルームコードで接続'}</h2><p>ルールとチップの設定は、接続先の卓から読み込みます。</p></div> :
          <RulePicker value={variantId} onChange={onVariantChange} onEdit={onEditRules} detailAnchor={header} />}
      </section>
      <section className="setup-session-pane" aria-label="卓の設定">
        <div className="session-identity"><EditableText label="あなたの名前" value={name} onChange={changeName} maxLength={PLAYER_NAME_MAX} placeholder="名前を入力" /></div>
        <nav className="tabs session-tabs" role="tablist" aria-label="プレイ方法">
          <span className="tab-indicator" aria-hidden="true" style={{ transform: `translateX(${mode === 'solo' ? '0' : 'calc(100% + 4px)'})` }} />
          {([['solo', 'ソロ'], ['online', 'オンライン']] as const).map(([id, name]) =>
            <button key={id} type="button" role="tab" id={`mode-${id}`} aria-selected={mode === id} aria-controls={`panel-${id}`} className={`tab ${mode === id ? 'tab-active' : ''}`} onClick={() => onModeChange(id)}>{name}</button>)}
        </nav>
        <div hidden={mode !== 'solo'} role="tabpanel" id="panel-solo" aria-labelledby="mode-solo"><SoloPanel onStart={onStartSolo} variantId={variantId} name={name} /></div>
        <div hidden={mode !== 'online'} role="tabpanel" id="panel-online" aria-labelledby="mode-online"><div className="online-options">
          <div className="online-connection-switch" aria-label="オンラインの接続方法"><button type="button" aria-pressed={connection === 'p2p'} onClick={() => setConnection('p2p')}>P2P</button><button type="button" aria-pressed={connection === 'server'} onClick={() => setConnection('server')}>サーバー</button></div>
          {connection === 'server' ? <ServerPanel onStart={onStartServer} variantId={variantId} name={name} role={onlineRole} onRoleChange={setOnlineRole} /> : <OnlinePanel onStart={onStartOnline} variantId={variantId} name={name} role={onlineRole} onRoleChange={setOnlineRole} />}
        </div></div>
      </section>
    </main>
    <footer className="setup-footer"><span>ルール・挙動の確認用</span><span>カスタムルールはこのブラウザに保存</span></footer>
    {about && <GameDialog title="このプレビューについて" className="preview-dialog" anchor={aboutTrigger.current} placement="below" onClose={() => setAbout(false)}>
      <p className="preview-intro">ルール・盤面・進行の検証版</p>
      <table className="preview-modes"><tbody>
        <tr><th scope="row">ソロ</th><td>CPU と対局</td></tr>
        <tr><th scope="row">P2P</th><td>端末間で接続・主催者が進行</td></tr>
        <tr><th scope="row">サーバー</th><td>作成キーで作成・招待で参加<br /><small>再接続・履歴に対応</small></td></tr>
      </tbody></table>
      <dl className="preview-notes"><div><dt>ルール・バナー</dt><dd>このブラウザに保存</dd></div><div><dt>ルールの書き出し</dt><dd>編集 → 受け渡し</dd></div></dl>
      <p className="preview-pending">アカウント・クラブは未対応</p>
    </GameDialog>}
  </div>;
}

function OnlinePanel({ onStart, variantId, name, role, onRoleChange }: {
  readonly onStart: (settings: OnlineSettings) => void; readonly variantId: string; readonly name: string;
  readonly role: 'host' | 'guest'; readonly onRoleChange: (role: 'host' | 'guest') => void;
}) {
  const [code, setCode] = useState('');
  const [hostPlays, setHostPlays] = useState(true);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [ante, setAnte] = useState(0);
  const badChars = invalidRoomCodeChars(code);
  const blindsOk = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  const ready = name.trim().length > 0 && (role === 'host' ? blindsOk : isValidRoomCode(code));
  return <div className="session-config">
    <div className="session-fields">
      <div className="segmented"><button type="button" className={`segment ${role === 'host' ? 'segment-active' : ''}`} onClick={() => onRoleChange('host')}>部屋を作る</button><button type="button" className={`segment ${role === 'guest' ? 'segment-active' : ''}`} onClick={() => onRoleChange('guest')}>参加する</button></div>
      {role === 'guest' ? <label className="field"><span className="field-label">ルームコード（{ROOM_CODE_LENGTH}文字）</span><input className="input input-code" value={code} autoCapitalize="characters" placeholder="ABCDEF" onChange={event => setCode(normalizeRoomCode(event.target.value))} />{badChars.length > 0 && <span className="hint hint-warn">{badChars.join(' ')} は使用できません。</span>}</label> : <>
        <TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} ante={ante} onAnte={setAnte} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
        <label className="checkline"><input type="checkbox" checked={hostPlays} onChange={event => setHostPlays(event.target.checked)} /><span>自分も席に着く</span></label>
        {!blindsOk && <p className="hint hint-warn">SB ≦ BB ≦ 初期チップに設定してください。</p>}
      </>}
      <p className="session-note">接続中だけの一時的な卓です。部屋を作った端末が進行を担当します。</p>
    </div>
    <div className="session-launch"><button type="button" className="btn btn-primary btn-large btn-block" disabled={!ready} onClick={() => onStart({ role, roomCode: role === 'host' ? createRoomCode() : code, name: name.trim(), chips, smallBlind, bigBlind, ante, hostPlays, variantId })}>{role === 'host' ? '部屋を作る' : '接続する'}<Icon kind="arrow-right" /></button></div>
  </div>;
}
