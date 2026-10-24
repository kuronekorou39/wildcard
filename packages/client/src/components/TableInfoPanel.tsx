import { useState, type ReactNode } from 'react';
import type { VisibleState } from '@wildcard/engine';
import { TABLE_SHAPES, type TableShape } from '../tableAppearance.js';
import { GameDialog } from './GameDialog.js';
import { RuleSheet } from './RulePicker.js';
import { CardAppearanceOptions } from './CardAppearancePicker.js';
import { TableFelt } from './TableFelt.js';
import { SoundSettings } from './SoundSettings.js';

const TABS = [['table', 'テーブル'], ['rules', 'ルール'], ['appearance', '見た目'], ['sound', 'サウンド']] as const;

export function TableInfoPanel({ state, title, subtitle, notices, controls, shape, onShapeChange, shapeSaveFailed, onClose, revealRunout, onRunoutChange, runoutSaveFailed }: {
  readonly revealRunout: boolean;
  readonly onRunoutChange: (value: boolean) => void;
  readonly runoutSaveFailed: boolean;
  readonly state: VisibleState;
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly notices: ReactNode;
  readonly controls: ReactNode;
  readonly shape: TableShape;
  readonly onShapeChange: (shape: TableShape) => void;
  readonly shapeSaveFailed: boolean;
  readonly onClose: () => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('table');
  return (
    <GameDialog title="卓の情報" className="table-info-panel" onClose={onClose}>
      <div className="table-info-tabs" role="tablist" aria-label="卓の情報の分類">
        {TABS.map(([id, name], index) => (
          <button key={id} type="button" role="tab" id={`info-tab-${id}`} aria-selected={tab === id}
            aria-controls="table-info-content" tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'info-tab-active' : ''} onClick={() => setTab(id)}
            onKeyDown={event => {
              const nextIndex = event.key === 'ArrowRight' ? (index + 1) % TABS.length
                : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
              if (nextIndex === null) return;
              event.preventDefault();
              const next = TABS[nextIndex]!;
              setTab(next[0]);
              event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#info-tab-${next[0]}`)?.focus();
            }}>{name}</button>
        ))}
      </div>
      <div role="tabpanel" id="table-info-content" aria-labelledby={`info-tab-${tab}`}>
        {tab === 'table' && <>
          <p className="table-info-mode">{title}</p>
          <div className="table-info-subtitle">{subtitle}</div>
          <dl className="table-facts">
            <div><dt>ルール</dt><dd>{state.variant.name}</dd></div>
            <div><dt>参加者</dt><dd>{state.players.length} / {state.seatCount}人</dd></div>
            <div><dt>ブラインド</dt><dd>SB {state.smallBlind} / BB {state.bigBlind}</dd></div>
            <div><dt>持ち時間</dt><dd>1手番 30秒</dd></div>
          </dl>
          <p className="hint">時間切れはチェックできればチェック、それ以外はフォールドします。本数の選択は1本になります。</p>
          <div className="position-legend">
            <span><b className="table-position-chip position-d">D</b>ディーラー</span>
            <span><b className="table-position-chip position-sb">SB</b>スモール</span>
            <span><b className="table-position-chip position-bb">BB</b>ビッグ</span>
          </div>
          <div className="table-info-notices">{notices}</div>
          <div className="table-info-controls">{controls}</div>
        </>}
        {tab === 'rules' && <RuleSheet variant={state.variant} label="役の順位・デッキ" defaultOpen />}
        {tab === 'sound' && <SoundSettings />}
        {tab === 'appearance' && <>
          <p className="hint">この端末の表示設定</p>
          <label className="checkline runout-setting"><input type="checkbox" checked={revealRunout} onChange={e => onRunoutChange(e.target.checked)} />
            <span>オールイン勝負は手札を開いてランアウト</span></label>
          {runoutSaveFailed && <p className="hint">表示を変更しました。このブラウザへの保存はできませんでした。</p>}
          <fieldset className="shape-fieldset">
            <legend>テーブルの形</legend>
            <div className="shape-options">
              {TABLE_SHAPES.map(option => (
                <label key={option.id} className="shape-option" title={option.description}>
                  <input type="radio" name="table-shape" value={option.id} checked={shape === option.id} onChange={() => onShapeChange(option.id)} />
                  <span className="shape-preview"><TableFelt shape={option.id} /></span>
                  <span>{option.name}</span>
                </label>
              ))}
            </div>
            {shapeSaveFailed && <p className="hint">形を変更しました。このブラウザへの保存はできませんでした。</p>}
          </fieldset>
          <h3 className="info-appearance-title">カードのデザイン</h3>
          <CardAppearanceOptions />
        </>}
      </div>
    </GameDialog>
  );
}
