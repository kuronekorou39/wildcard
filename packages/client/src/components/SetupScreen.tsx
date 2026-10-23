import { useState } from 'react';
import type { HotSeatSettings } from '../modes/HotSeatTable.js';
import type { OnlineSettings } from '../modes/OnlineTable.js';
import type { SoloSettings } from '../modes/SoloTable.js';
import { SoloPanel } from './SoloPanel.js';
import { RulePicker } from './RulePicker.js';
import { Brand } from './Brand.js';
import { EditableText, TableStakes } from './EditableValue.js';
import { GameDialog } from './GameDialog.js';
import { ROOM_CODE_LENGTH, createRoomCode, invalidRoomCodeChars, isValidRoomCode, normalizeRoomCode } from '../room.js';
import { ServerPanel } from './ServerPanel.js';
import { invitedTable, type ServerSettings } from '../serverConnection.js';

export type SetupMode = 'online' | 'solo' | 'hotseat';
interface SetupScreenProps {
  readonly variantId: string;
  readonly onVariantChange: (id: string) => void;
  readonly onEditRules: (id: string) => void;
  readonly mode: SetupMode;
  readonly onModeChange: (mode: SetupMode) => void;
  readonly onStartHotSeat: (settings: HotSeatSettings) => void;
  readonly onStartOnline: (settings: OnlineSettings) => void;
  readonly onStartServer: (settings: ServerSettings) => void;
  readonly onStartSolo: (settings: SoloSettings) => void;
}

export function SetupScreen({ mode, onModeChange, variantId, onVariantChange, onEditRules, onStartHotSeat, onStartOnline, onStartServer, onStartSolo }: SetupScreenProps) {
  const [onlineRole, setOnlineRole] = useState<'host' | 'guest'>(() => invitedTable() ? 'guest' : 'host');
  const [connection, setConnection] = useState<'server' | 'p2p'>(() => invitedTable() ? 'server' : 'p2p');
  const [about, setAbout] = useState(false);
  return <div className="screen screen-setup setup-shell">
    <header className="setup-header"><Brand /><button type="button" className="preview-badge" onClick={() => setAbout(true)}>PREVIEW <span aria-hidden="true">ⓘ</span></button></header>
    <div className="setup-heading"><h1>テーブルの準備</h1><p>ルールと進行を確かめる。</p></div>
    <main className="setup-desk">
      <section className="setup-rule-pane" aria-label="ルールの設定">
        {mode === 'online' && onlineRole === 'guest' ? <div className="join-context"><span className="section-kicker">01 / 接続先のルール</span><span aria-hidden="true">↗</span><h2>{connection === 'server' ? '招待リンクで参加' : 'ルームコードで接続'}</h2><p>ルールとチップの設定は、接続先の卓から読み込みます。</p></div> :
          <RulePicker value={variantId} onChange={onVariantChange} onEdit={onEditRules} />}
      </section>
      <section className="setup-session-pane" aria-label="卓の設定">
        <div className="section-kicker"><span>02 / 確認方法</span></div>
        <nav className="tabs session-tabs" role="tablist" aria-label="確認方法">
          {([['solo', 'ソロ', 'CPU と確認'], ['hotseat', 'ホットシート', '1 台で操作'], ['online', 'オンライン', '端末を接続']] as const).map(([id, name, caption]) =>
            <button key={id} type="button" role="tab" id={`mode-${id}`} aria-selected={mode === id} aria-controls={`panel-${id}`} className={`tab ${mode === id ? 'tab-active' : ''}`} onClick={() => onModeChange(id)}>{name}<small>{caption}</small></button>)}
        </nav>
        <div hidden={mode !== 'solo'} role="tabpanel" id="panel-solo" aria-labelledby="mode-solo"><SoloPanel onStart={onStartSolo} variantId={variantId} /></div>
        <div hidden={mode !== 'hotseat'} role="tabpanel" id="panel-hotseat" aria-labelledby="mode-hotseat"><HotSeatPanel onStart={onStartHotSeat} variantId={variantId} /></div>
        <div hidden={mode !== 'online'} role="tabpanel" id="panel-online" aria-labelledby="mode-online"><div className="online-options">
          <div className="online-connection-switch" aria-label="オンラインの接続方法"><button type="button" aria-pressed={connection === 'p2p'} onClick={() => setConnection('p2p')}>P2P</button><button type="button" aria-pressed={connection === 'server'} onClick={() => setConnection('server')}>サーバー</button></div>
          {connection === 'server' ? <ServerPanel onStart={onStartServer} variantId={variantId} role={onlineRole} onRoleChange={setOnlineRole} /> : <OnlinePanel onStart={onStartOnline} variantId={variantId} role={onlineRole} onRoleChange={setOnlineRole} />}
        </div></div>
      </section>
    </main>
    <footer className="setup-footer"><span>ルール・挙動の確認用</span><span>カスタムルールはこのブラウザに保存</span></footer>
    {about && <GameDialog title="このプレビューについて" onClose={() => setAbout(false)}><p>ルールの編集と、テーブルの表示・進行を確認するためのプレビューです。</p><p>P2P は部屋を作った端末が進行する一時的な卓です。サーバー接続では再接続とハンドの保存を検証できます。アカウント・クラブはまだありません。</p><p>作成したルールとバナーは、このブラウザに保存されます。ルールは編集画面の「受け渡し」から書き出せます。</p></GameDialog>}
  </div>;
}

function OnlinePanel({ onStart, variantId, role, onRoleChange }: {
  readonly onStart: (settings: OnlineSettings) => void; readonly variantId: string;
  readonly role: 'host' | 'guest'; readonly onRoleChange: (role: 'host' | 'guest') => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [hostPlays, setHostPlays] = useState(true);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const badChars = invalidRoomCodeChars(code);
  const blindsOk = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  const ready = name.trim().length > 0 && (role === 'host' ? blindsOk : isValidRoomCode(code));
  return <div className="session-config">
    <div className="session-fields">
      <div className="segmented"><button type="button" className={`segment ${role === 'host' ? 'segment-active' : ''}`} onClick={() => onRoleChange('host')}>部屋を作る</button><button type="button" className={`segment ${role === 'guest' ? 'segment-active' : ''}`} onClick={() => onRoleChange('guest')}>参加する</button></div>
      <label className="field"><span className="field-label">あなたの名前</span><input className="input" value={name} maxLength={12} placeholder="名前を入力" onChange={event => setName(event.target.value)} /></label>
      {role === 'guest' ? <label className="field"><span className="field-label">ルームコード（{ROOM_CODE_LENGTH}文字）</span><input className="input input-code" value={code} autoCapitalize="characters" placeholder="ABCDEF" onChange={event => setCode(normalizeRoomCode(event.target.value))} />{badChars.length > 0 && <span className="hint hint-warn">{badChars.join(' ')} は使用できません。</span>}</label> : <>
        <TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
        <label className="checkline"><input type="checkbox" checked={hostPlays} onChange={event => setHostPlays(event.target.checked)} /><span>自分も席に着く</span></label>
        {!blindsOk && <p className="hint hint-warn">SB ≦ BB ≦ 初期チップに設定してください。</p>}
      </>}
      <p className="session-note">接続中だけの一時的な卓です。部屋を作った端末が進行を担当します。</p>
    </div>
    <div className="session-launch"><button type="button" className="btn btn-primary btn-large btn-block" disabled={!ready} onClick={() => onStart({ role, roomCode: role === 'host' ? createRoomCode() : code, name: name.trim(), chips, smallBlind, bigBlind, hostPlays, variantId })}>{role === 'host' ? '部屋を作る' : '接続する'} <span aria-hidden="true">→</span></button></div>
  </div>;
}

function HotSeatPanel({ onStart, variantId }: { readonly onStart: (settings: HotSeatSettings) => void; readonly variantId: string }) {
  const [names, setNames] = useState(['プレイヤー1', 'プレイヤー2']);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const valid = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  return <div className="session-config">
    <div className="session-fields">
      <div className="field"><span className="field-label">プレイヤー</span><div className="player-count-control"><button type="button" className="btn" aria-label="プレイヤーを減らす" disabled={names.length <= 2} onClick={() => setNames(current => current.slice(0, -1))}>−</button><strong>{names.length}<small>人</small></strong><button type="button" className="btn" aria-label="プレイヤーを増やす" disabled={names.length >= 10} onClick={() => setNames(current => [...current, `プレイヤー${current.length + 1}`])}>＋</button><button type="button" className="btn btn-ghost" onClick={() => setPlayersOpen(true)}>名前を編集 ↗</button></div></div>
      <TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
      {!valid && <p className="hint hint-warn">SB ≦ BB ≦ 初期チップに設定してください。</p>}
      <p className="session-note">手番ごとに手札を伏せ、1 台の端末で順番に操作します。</p>
    </div>
    <div className="session-launch"><span className="session-overview">{names.length} 席 · ローカル</span><button type="button" className="btn btn-primary btn-large btn-block" disabled={!valid} onClick={() => onStart({ names: names.map((name, i) => name.trim() || `プレイヤー${i + 1}`), chips, smallBlind, bigBlind, variantId })}>卓につく <span aria-hidden="true">→</span></button></div>
    {playersOpen && <GameDialog title="プレイヤー" onClose={() => setPlayersOpen(false)}><ul className="player-list">{names.map((name, i) => <li className="player-row" key={i}><span className="player-index">{String(i + 1).padStart(2, '0')}</span><EditableText label={`プレイヤー${i + 1}の名前`} value={name} maxLength={12} onChange={value => setNames(current => current.map((old, at) => at === i ? value : old))} /></li>)}</ul></GameDialog>}
  </div>;
}
