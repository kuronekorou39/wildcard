import { useState } from 'react';
import type { HotSeatSettings } from '../modes/HotSeatTable.js';
import type { OnlineSettings } from '../modes/OnlineTable.js';
import { RulePicker } from './RulePicker.js';
import {
  ROOM_CODE_LENGTH,
  createRoomCode,
  invalidRoomCodeChars,
  isValidRoomCode,
  normalizeRoomCode,
} from '../room.js';

interface SetupScreenProps {
  readonly onStartHotSeat: (settings: HotSeatSettings) => void;
  readonly onStartOnline: (settings: OnlineSettings) => void;
}

type Mode = 'online' | 'hotseat';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

export function SetupScreen({ onStartHotSeat, onStartOnline }: SetupScreenProps) {
  const [mode, setMode] = useState<Mode>('online');

  return (
    <div className="screen screen-setup">
      <header className="hero">
        <h1 className="hero-title">Wildcard</h1>
        <p className="hero-tagline">ルールを自分で決めるポーカー</p>
      </header>

      <nav className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'online'}
          className={`tab ${mode === 'online' ? 'tab-active' : ''}`}
          onClick={() => setMode('online')}
        >
          オンライン
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'hotseat'}
          className={`tab ${mode === 'hotseat' ? 'tab-active' : ''}`}
          onClick={() => setMode('hotseat')}
        >
          ホットシート
        </button>
      </nav>

      {mode === 'online' ? (
        <OnlinePanel onStart={onStartOnline} />
      ) : (
        <HotSeatPanel onStart={onStartHotSeat} />
      )}

      <section className="panel panel-muted">
        <h2 className="panel-title">これから</h2>
        <ul className="roadmap">
          <li>CPU相手のソロ対戦</li>
          <li>カスタムルール（カードの強さ・独自の役）のエディタ</li>
          <li>配牌の公正さを全員で検証できる仕組み</li>
        </ul>
        <p className="panel-note">
          エンジンはすでにカスタムルールに対応済みで、残っているのは設定画面です。
        </p>
      </section>
    </div>
  );
}

// ============================================================
// オンライン
// ============================================================

function OnlinePanel({ onStart }: { readonly onStart: (settings: OnlineSettings) => void }) {
  const [role, setRole] = useState<'host' | 'guest'>('host');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [hostPlays, setHostPlays] = useState(true);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [ruleSetId, setRuleSetId] = useState('standard');

  const trimmedName = name.trim();
  const badChars = invalidRoomCodeChars(code);
  const codeOk = role === 'host' || isValidRoomCode(code);
  const blindsOk = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  const ready = trimmedName.length > 0 && codeOk && (role === 'guest' || blindsOk);

  const start = () => {
    onStart({
      role,
      roomCode: role === 'host' ? createRoomCode() : code,
      name: trimmedName,
      chips,
      smallBlind,
      bigBlind,
      hostPlays,
      ruleSetId,
    });
  };

  return (
    <section className="panel">
      <p className="panel-note">
        サーバーは使いません。端末どうしが直接つながります（WebRTC）。
        部屋を作った人の端末が進行役になり、その人だけがゲームを進めます。
      </p>

      <div className="segmented">
        <button
          type="button"
          className={`segment ${role === 'host' ? 'segment-active' : ''}`}
          onClick={() => setRole('host')}
        >
          部屋を作る
        </button>
        <button
          type="button"
          className={`segment ${role === 'guest' ? 'segment-active' : ''}`}
          onClick={() => setRole('guest')}
        >
          参加する
        </button>
      </div>

      <label className="field">
        <span className="field-label">あなたの名前</span>
        <input
          className="input"
          value={name}
          maxLength={12}
          placeholder="名前を入力"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {role === 'guest' && (
        <label className="field">
          <span className="field-label">ルームコード（{ROOM_CODE_LENGTH}文字）</span>
          <input
            className="input input-code"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            placeholder="ABCDEF"
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
          />
          {badChars.length > 0 && (
            <p className="hint hint-warn">
              {badChars.join(' ')} は使われていない文字です。見間違えやすいので
              O・I・L・0・1 は使っていません。
            </p>
          )}
        </label>
      )}

      {role === 'host' && (
        <>
          <label className="checkline">
            <input
              type="checkbox"
              checked={hostPlays}
              onChange={(e) => setHostPlays(e.target.checked)}
            />
            <span>
              自分も席に着く
              <small className="checkline-note">
                外すと席を持たないディーラーになります。進行役の端末は全員の手札を
                計算できる立場なので、遊ばない人がいるならその人が部屋を作るのが安全です。
              </small>
            </span>
          </label>

          <div className="field-row">
            <label className="field">
              <span className="field-label">初期チップ</span>
              <input
                className="input"
                type="number"
                min={1}
                value={chips}
                onChange={(e) => setChips(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">SB</span>
              <input
                className="input"
                type="number"
                min={1}
                value={smallBlind}
                onChange={(e) => setSmallBlind(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="field-label">BB</span>
              <input
                className="input"
                type="number"
                min={1}
                value={bigBlind}
                onChange={(e) => setBigBlind(Number(e.target.value))}
              />
            </label>
          </div>

          {!blindsOk && (
            <p className="hint hint-warn">
              ブラインドは SB ≦ BB ≦ 初期チップ になるように設定してください。
            </p>
          )}

          <RulePicker value={ruleSetId} onChange={setRuleSetId} />
        </>
      )}

      {role === 'guest' && (
        <p className="hint">ルールは部屋を作った人の設定が使われます。</p>
      )}

      <button
        type="button"
        className="btn btn-primary btn-large btn-block"
        disabled={!ready}
        onClick={start}
      >
        {role === 'host' ? '部屋を作る' : '参加する'}
      </button>
    </section>
  );
}

// ============================================================
// ホットシート
// ============================================================

function HotSeatPanel({ onStart }: { readonly onStart: (settings: HotSeatSettings) => void }) {
  const [names, setNames] = useState<string[]>(['プレイヤー1', 'プレイヤー2']);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [ruleSetId, setRuleSetId] = useState('standard');

  const setName = (index: number, value: string) => {
    setNames((current) => current.map((name, i) => (i === index ? value : name)));
  };

  const addPlayer = () => {
    setNames((current) =>
      current.length >= MAX_PLAYERS ? current : [...current, `プレイヤー${current.length + 1}`],
    );
  };

  const removePlayer = (index: number) => {
    setNames((current) =>
      current.length <= MIN_PLAYERS ? current : current.filter((_, i) => i !== index),
    );
  };

  const blindsValid = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;

  return (
    <section className="panel">
      <p className="panel-note">
        1台の端末を順番に回して遊びます。手番が移るたびに目隠しが入るので、
        他の人にホールカードは見えません。通信もサーバーも使いません。
      </p>

      <div className="field">
        <span className="field-label">プレイヤー（{names.length}人）</span>
        <ul className="player-list">
          {names.map((name, i) => (
            <li key={i} className="player-row">
              <input
                className="input"
                value={name}
                maxLength={12}
                onChange={(e) => setName(i, e.target.value)}
                aria-label={`プレイヤー${i + 1}の名前`}
              />
              <button
                type="button"
                className="btn btn-muted btn-small"
                onClick={() => removePlayer(i)}
                disabled={names.length <= MIN_PLAYERS}
                aria-label={`プレイヤー${i + 1}を外す`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-muted btn-small"
          onClick={addPlayer}
          disabled={names.length >= MAX_PLAYERS}
        >
          ＋ 追加
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">初期チップ</span>
          <input
            className="input"
            type="number"
            min={1}
            value={chips}
            onChange={(e) => setChips(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field-label">SB</span>
          <input
            className="input"
            type="number"
            min={1}
            value={smallBlind}
            onChange={(e) => setSmallBlind(Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span className="field-label">BB</span>
          <input
            className="input"
            type="number"
            min={1}
            value={bigBlind}
            onChange={(e) => setBigBlind(Number(e.target.value))}
          />
        </label>
      </div>

      {!blindsValid && (
        <p className="hint hint-warn">
          ブラインドは SB ≦ BB ≦ 初期チップ になるように設定してください。
        </p>
      )}

      <RulePicker value={ruleSetId} onChange={setRuleSetId} />

      <button
        type="button"
        className="btn btn-primary btn-large btn-block"
        disabled={!blindsValid}
        onClick={() => onStart({ names, chips, smallBlind, bigBlind, ruleSetId })}
      >
        卓につく
      </button>
    </section>
  );
}
