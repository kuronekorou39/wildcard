import { useState } from 'react';
import type { HotSeatSettings } from '../modes/HotSeatTable.js';

interface SetupScreenProps {
  readonly onStart: (settings: HotSeatSettings) => void;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

export function SetupScreen({ onStart }: SetupScreenProps) {
  const [names, setNames] = useState<string[]>(['プレイヤー1', 'プレイヤー2']);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);

  const setName = (index: number, value: string) => {
    setNames((current) => current.map((name, i) => (i === index ? value : name)));
  };

  const addPlayer = () => {
    setNames((current) =>
      current.length >= MAX_PLAYERS ? current : [...current, `プレイヤー${current.length + 1}`],
    );
  };

  const removePlayer = (index: number) => {
    setNames((current) => (current.length <= MIN_PLAYERS ? current : current.filter((_, i) => i !== index)));
  };

  const blindsValid = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;

  return (
    <div className="screen screen-setup">
      <header className="hero">
        <h1 className="hero-title">Wildcard</h1>
        <p className="hero-tagline">ルールを自分で決めるポーカー</p>
      </header>

      <section className="panel">
        <h2 className="panel-title">ホットシート</h2>
        <p className="panel-note">
          1台の端末を順番に回して遊びます。手番が移るたびに目隠しが入るので、
          他の人にホールカードは見えません。サーバーは使いません。
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
            <span className="field-label">スモールブラインド</span>
            <input
              className="input"
              type="number"
              min={1}
              value={smallBlind}
              onChange={(e) => setSmallBlind(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span className="field-label">ビッグブラインド</span>
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

        <button
          type="button"
          className="btn btn-primary btn-large btn-block"
          disabled={!blindsValid}
          onClick={() => onStart({ names, chips, smallBlind, bigBlind })}
        >
          卓につく
        </button>
      </section>

      <section className="panel panel-muted">
        <h2 className="panel-title">これから</h2>
        <ul className="roadmap">
          <li>CPU相手のソロ対戦</li>
          <li>カスタムルール（カードの強さ・独自の役）のエディタ</li>
          <li>オンライン対戦（サーバーを立てたときだけ）</li>
        </ul>
        <p className="panel-note">
          エンジンはすでにカスタムルールに対応済みで、残っているのは設定画面です。
        </p>
      </section>
    </div>
  );
}
