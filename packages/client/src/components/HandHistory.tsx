import { useState } from 'react';
import { streetName, type HandHistoryStep, type VisibleState } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';

const labels: Record<HandHistoryStep['kind'], string> = {
  deal: '配牌', blind: 'ブラインド', straddle: 'ストラドル', fold: 'フォールド', check: 'チェック', call: 'コール', raise: 'レイズ',
  'timeout-check': '時間切れ · チェック', 'timeout-fold': '時間切れ · フォールド', 'run-once': '1本でランアウト',
  'run-agree': '複数本に同意', collect: 'チップを回収', burn: 'バーン', board: '場を開く', refund: '未コール分を返却', award: 'ポットを獲得',
};
export function historyLabel(step: HandHistoryStep, state: VisibleState) {
  const name = step.players.find(p => p.id === step.playerId)?.name;
  const label = step.kind === 'blind' ? step.blind : step.kind === 'board' ? streetName(state.variant, step.streetIndex) : labels[step.kind];
  const amount = step.kind === 'raise' ? ` ${step.to?.toLocaleString()}（+${step.amount?.toLocaleString()}）`
    : step.amount ? ` ${step.amount.toLocaleString()}${step.kind === 'burn' ? '枚' : ''}` : '';
  return `${step.run !== undefined && (state.summary?.runs?.length ?? 1) > 1 ? `${step.run + 1}本目 · ` : ''}${name ? `${name} · ` : ''}${label}${amount}`;
}

export function HandHistory({ state }: { readonly state: VisibleState }) {
  const steps = state.history ?? [];
  const [index, setIndex] = useState(0);
  const step = steps[index], previous = steps[index - 1];
  if (!step) return <p className="summary-note">このハンドには手順の記録がありません。</p>;
  const pending = step.players.reduce((sum,p) => sum + p.bet,0);
  const move = step.kind === 'collect' ? '各席の前 → 中央'
    : step.kind === 'award' || step.kind === 'refund' ? '中央 → 持ちチップ'
    : step.amount && ['call','raise','blind','straddle'].includes(step.kind) ? '持ちチップ → 席の前' : null;
  return <section className="hand-history" aria-label="ハンドの手順">
    <div className="history-navigation">
      <button className="btn" disabled={index === 0} onClick={() => setIndex(i => i-1)} aria-label="前の手順">←</button>
      <output>{index + 1} / {steps.length}</output>
      <button className="btn" disabled={index === steps.length-1} onClick={() => setIndex(i => i+1)} aria-label="次の手順">→</button>
    </div>
    <input type="range" min={0} max={steps.length-1} step={1} value={index} onChange={e => setIndex(Number(e.target.value))} aria-label="表示する手順" />
    <div className="history-snapshot" aria-live="polite">
      <strong className="history-current">{historyLabel(step, state)}</strong>
      <div className="history-board">
        {step.boards.map((board, run) => <div className="history-board-row" key={run}>
          {step.boards.length > 1 && <small>{run + 1}本目</small>}
          {board.length ? board.map((card,i) => <PlayingCard key={i} card={card} size="sm" />) : <span className="history-empty">プリフロップ</span>}
        </div>)}
        <div className="history-pot" aria-label={`回収済み ${step.pot}、未回収 ${pending}`}>
          <strong>{step.pot.toLocaleString()}</strong>{pending > 0 && <span>（+{pending.toLocaleString()}）</span>}
        </div>
      </div>
      <div className="history-transfer">{move && <><span className="history-chip" aria-hidden="true" /><span>{move}</span><strong>{step.amount?.toLocaleString()}</strong></>}</div>
      <table className="history-stacks"><thead><tr><th>プレイヤー</th><th>持ちチップ</th><th>席の前</th></tr></thead>
        <tbody>{step.players.map(p => {
          const old = previous?.players.find(b => b.id === p.id);
          const delta = old ? p.chips - old.chips : 0;
          return <tr key={p.id} className={`${p.folded ? 'history-folded' : ''} ${step.playerId === p.id ? 'history-actor' : ''}`}>
            <th>{p.name}{p.folded ? <small>フォールド</small> : p.allIn ? <small>ALL IN</small> : null}</th>
            <td>{p.chips.toLocaleString()}<small className={delta > 0 ? 'history-gain' : 'history-spent'}>{delta !== 0 ? `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}` : '\u00a0'}</small></td>
            <td>{p.bet.toLocaleString()}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <details className="history-list"><summary>すべての手順</summary><ol>{steps.map((s,i) => <li key={i}>
      <button type="button" aria-current={index === i ? 'step' : undefined} onClick={() => setIndex(i)}>{historyLabel(s, state)}</button>
    </li>)}</ol></details>
  </section>;
}
