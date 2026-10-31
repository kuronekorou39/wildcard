import { useState } from 'react';
import type { SoloSettings } from '../modes/SoloTable.js';
import { TableStakes } from './EditableValue.js';
import { Icon } from './Icon.js';

export function SoloPanel({ onStart, variantId, name }: { readonly onStart: (settings: SoloSettings) => void; readonly variantId: string; readonly name: string }) {
  const [opponents, setOpponents] = useState(2);
  const [chips, setChips] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(10);
  const [bigBlind, setBigBlind] = useState(20);
  const [ante, setAnte] = useState(0);
  const [aggression, setAggression] = useState(0.5);
  const [mixedCpu, setMixedCpu] = useState(true);
  const valid = smallBlind > 0 && bigBlind >= smallBlind && chips >= bigBlind;
  return <div className="session-config">
    <div className="session-fields">
      <div className="field"><span className="field-label">CPU の人数 <small>全 {opponents + 1} 席</small></span><div className="seat-count-picker" role="group" aria-label="CPU の人数">{Array.from({ length: 9 }, (_, i) => i + 1).map(n => <button type="button" key={n} aria-pressed={opponents === n} onClick={() => setOpponents(n)}>{n}</button>)}</div></div>
      <div className="field"><span className="field-label">CPU の打ち方</span><div className="segmented cpu-style-picker">
        {([[.15, '慎重', 'gauge-low'], [.5, '標準', 'gauge-mid'], [.85, '強気', 'gauge-high']] as const).map(([value, label, icon]) => <button type="button" key={value} aria-pressed={!mixedCpu && aggression === value} className={`segment ${!mixedCpu && aggression === value ? 'segment-active' : ''}`} onClick={() => { setMixedCpu(false); setAggression(value); }}><Icon kind={icon} />{label}</button>)}
        {/* 混在は「全員同じ」ではなく割り当て方なので、仕切りで分ける */}
        <span className="segment-divider" aria-hidden="true" />
        <button type="button" aria-pressed={mixedCpu} className={`segment ${mixedCpu ? 'segment-active' : ''}`} onClick={() => setMixedCpu(true)}><Icon kind="shuffle" />混在</button>
      </div></div>
      <TableStakes chips={chips} smallBlind={smallBlind} bigBlind={bigBlind} ante={ante} onAnte={setAnte} onChips={setChips} onSmallBlind={setSmallBlind} onBigBlind={setBigBlind} />
      {!valid && <p className="hint hint-warn">SB ≦ BB ≦ 初期チップに設定してください。</p>}
    </div>
    <div className="session-launch"><span className="session-overview">{opponents + 1} 席 · CPU {opponents} 人</span><button type="button" className="btn btn-primary btn-large btn-block" disabled={!valid} onClick={() => onStart({ name: name.trim() || 'あなた', opponents, chips, smallBlind, bigBlind, ante, variantId, aggression, mixedCpu })}>はじめる<Icon kind="arrow-right" /></button></div>
  </div>;
}
