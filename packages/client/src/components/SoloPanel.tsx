import { useState } from 'react';
import type { SoloSettings } from '../modes/SoloTable.js';
import { EditableText, TableStakes } from './EditableValue.js';

export function SoloPanel({ onStart, variantId }: { readonly onStart: (settings: SoloSettings) => void; readonly variantId: string }) {
  const [name, setName] = useState('あなた');
  const [opponents, setOpponents] = useState(2);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [aggression, setAggression] = useState(0.5);
  const valid = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  return <div className="session-config">
    <div className="session-fields">
      <EditableText label="あなたの名前" value={name} onChange={setName} maxLength={12} />
      <div className="field"><span className="field-label">CPU の人数 <small>全 {opponents + 1} 席</small></span><div className="seat-count-picker" role="group" aria-label="CPU の人数">{Array.from({ length: 9 }, (_, i) => i + 1).map(n => <button type="button" key={n} aria-pressed={opponents === n} onClick={() => setOpponents(n)}>{n}</button>)}</div></div>
      <div className="field"><span className="field-label">CPU の打ち方</span><div className="segmented">{([[.15, '慎重'], [.5, '標準'], [.85, '強気']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={aggression === value} className={`segment ${aggression === value ? 'segment-active' : ''}`} onClick={() => setAggression(value)}>{label}</button>)}</div></div>
      <TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
      {!valid && <p className="hint hint-warn">SB ≦ BB ≦ 初期チップに設定してください。</p>}
    </div>
    <div className="session-launch"><span className="session-overview">{opponents + 1} 席 · CPU {opponents} 人</span><button type="button" className="btn btn-primary btn-large btn-block" disabled={!valid} onClick={() => onStart({ name: name.trim() || 'あなた', opponents, chips, smallBlind, bigBlind, variantId, aggression })}>はじめる <span aria-hidden="true">→</span></button></div>
  </div>;
}
