import { useState } from 'react';
import type { SoloSettings } from '../modes/SoloTable.js';
import { RulePicker } from './RulePicker.js';

export function SoloPanel({
  onStart,
  rules,
}: {
  readonly onStart: (settings: SoloSettings) => void;
  readonly rules: {
    readonly variantId: string;
    readonly onVariantChange: (variantId: string) => void;
    readonly onEditRules: (sourceId: string) => void;
  };
}) {
  const [name, setName] = useState('あなた');
  const [opponents, setOpponents] = useState(2);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const variantId = rules.variantId;
  const [aggression, setAggression] = useState(0.5);

  const blindsOk = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;

  return (
    <section className="panel">
      <p className="panel-note">
        CPU を相手に、自分のペースで練習できます。
        自分で作ったルールも、そのまま試してみよう。
      </p>

      <label className="field">
        <span className="field-label">あなたの名前</span>
        <input
          className="input"
          value={name}
          maxLength={12}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">CPU の人数: {opponents}人</span>
        <input
          className="range"
          type="range"
          min={1}
          max={9}
          value={opponents}
          onChange={(e) => setOpponents(Number(e.target.value))}
        />
        <span className="hint">あなたを含めて{opponents + 1}人の卓</span>
      </label>

      <label className="field">
        <span className="field-label">CPU の打ち方: {aggressionLabel(aggression)}</span>
        <input
          className="range"
          type="range"
          min={0}
          max={100}
          value={Math.round(aggression * 100)}
          onChange={(e) => setAggression(Number(e.target.value) / 100)}
        />
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

      <RulePicker value={variantId} onChange={rules.onVariantChange} onEdit={rules.onEditRules} />

      <button
        type="button"
        className="btn btn-primary btn-large btn-block"
        disabled={!blindsOk}
        onClick={() =>
          onStart({ name, opponents, chips, smallBlind, bigBlind, variantId, aggression })
        }
      >
        はじめる
      </button>
    </section>
  );
}

function aggressionLabel(value: number): string {
  if (value < 0.25) return '慎重';
  if (value < 0.45) return 'やや慎重';
  if (value < 0.6) return 'ふつう';
  if (value < 0.8) return 'やや強気';
  return '強気';
}
