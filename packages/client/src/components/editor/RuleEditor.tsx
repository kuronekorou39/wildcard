import { useMemo, useState } from 'react';
import { RANKS, SUITS, deckSize, maxPlayersFor, requiredCards, validateVariant, type Variant } from '@wildcard/engine';
import { Brand } from '../Brand.js';
import { Icon } from '../Icon.js';
import { RuleSheet } from '../RulePicker.js';
import { BannerEditor } from '../RuleBanner.js';
import { EditableNumber, EditableText } from '../EditableValue.js';
import { DeckEditor } from './DeckEditor.js';
import { StructureEditor } from './StructureEditor.js';
import { BettingEditor } from './BettingEditor.js';
import { RankingEditor } from './RankingEditor.js';
import { OptionsEditor } from './OptionsEditor.js';
import { ShareBox } from './ShareBox.js';
import { deleteCustomVariant, isCustomVariant, newCustomId, resolveVariant, saveCustomVariant } from '../../rules/customVariants.js';
import { ruleBanner, saveRuleBanner } from '../../rules/ruleBanners.js';

interface RuleEditorProps {
  readonly source: Variant;
  readonly onClose: () => void;
  readonly onPlay: (variantId: string) => void;
}
const SECTIONS = [
  ['info', 'ルール情報'], ['deck', 'デッキ'], ['structure', '配り方'], ['betting', 'ベット'],
  ['ranking', '役の強さ'], ['options', '卓の作法'], ['share', '受け渡し'], ['check', '検証'],
] as const;
type Section = typeof SECTIONS[number][0];

export function RuleEditor({ source, onClose, onPlay }: RuleEditorProps) {
  const [draft, setDraft] = useState<Variant>(() => isCustomVariant(source.id) ? source : { ...source, id: newCustomId(), name: `${source.name}（写し）` });
  const [banner, setBanner] = useState(() => ruleBanner(source.id));
  const [section, setSection] = useState<Section>('info');
  const [players, setPlayers] = useState(6);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const problems = useMemo(() => validateVariant(draft, players), [draft, players]);
  const ready = problems.length === 0 && draft.name.trim().length > 0;
  const update = (patch: Partial<Variant>) => { setDraft(current => ({ ...current, ...patch })); setSaved(false); setError(''); };
  const save = () => {
    if (!ready || bannerBusy) return false;
    if (!saveCustomVariant(draft) || !saveRuleBanner(draft.id, banner)) {
      setError('保存できませんでした。ブラウザの保存容量・設定を確認してください。');
      return false;
    }
    setSaved(true); setError(''); return true;
  };
  const cards = deckSize(draft.deck);
  const need = problems.length === 0 ? requiredCards(draft.structure, players) : null;
  const seats = problems.length === 0 ? maxPlayersFor(draft) : null;
  const status = problems.length > 0 ? `要確認 ${problems.length}件` : !draft.name.trim() ? '名前を入力してください' : '設定に矛盾なし';
  const select = (next: Section) => { setSection(next); };
  return <div className="screen screen-editor rules-shell">
    <header className="editor-head"><button type="button" className="btn btn-ghost btn-back" onClick={onClose}>← 戻る</button><Brand compact /><span className="preview-label">RULE EDITOR</span></header>
    <div className="editor-heading"><div><h1 className="editor-title">ルールを設定</h1><p className="editor-current-name">{draft.name}</p></div><span className="editor-save-state" role="status">{saved ? '保存済み' : '編集中'}</span></div>
    <div className="editor-workspace">
      <nav className="editor-nav" role="tablist" aria-label="ルールの編集項目">
        {SECTIONS.map(([id, label], i) => <button key={id} type="button" role="tab" aria-selected={section === id} id={`rules-tab-${id}`} aria-controls="rules-panel" onClick={() => select(id)}><span>{String(i + 1).padStart(2, '0')}</span>{label}{id === 'check' && !ready && <i aria-label="要確認">!</i>}</button>)}
      </nav>
      <main className="editor-content" id="rules-panel" role="tabpanel" aria-labelledby={`rules-tab-${section}`} key={section}>
        {section === 'info' && <section className="panel" id="rules-info">
          <h2 className="panel-title">ルール情報</h2>
          <EditableText label="名前" value={draft.name} maxLength={40} onChange={name => update({ name })} />
          <EditableText label="説明" value={draft.description ?? ''} maxLength={120} placeholder="説明を追加" onChange={description => update({ description })} />
          <div className="field"><span className="field-label">選択画面のバナー</span><BannerEditor variant={draft} value={banner} onBusyChange={setBannerBusy} onChange={value => { setBanner(value); setSaved(false); }} /></div>
          {isCustomVariant(source.id) && <button type="button" className="btn btn-danger editor-delete" onClick={() => { if (deleteCustomVariant(draft.id)) onClose(); else setError('ルールを削除できませんでした。'); }}>このルールを削除</button>}
        </section>}
        {section === 'deck' && <DeckEditor deck={draft.deck} allRanks={RANKS} allSuits={SUITS} onChange={deck => update({ deck })} />}
        {section === 'structure' && <StructureEditor structure={draft.structure} onChange={structure => update({ structure })} />}
        {section === 'betting' && <BettingEditor betting={draft.betting} structure={draft.structure} onChange={betting => update({ betting })} />}
        {section === 'ranking' && <RankingEditor variant={draft} onChange={ranking => update({ ranking })} />}
        {section === 'options' && <OptionsEditor options={draft.options} onChange={options => update({ options })} />}
        {section === 'share' && <ShareBox variant={draft} defaultOpen onImported={id => { const imported = resolveVariant(id); if (imported) { setDraft(imported); setBanner(ruleBanner(id)); setSaved(true); select('info'); } }} />}
        {section === 'check' && <section className="panel" id="rules-check"><h2 className="panel-title">検証</h2>
          <EditableNumber label="想定人数" value={players} min={2} max={10} suffix="人" onChange={setPlayers} />
          <p className={ready ? 'editor-ok' : 'hint-warn'}>{status}</p>
          <p className="editor-figures">デッキ {cards}枚{need !== null && <> ／ 必要 {need}枚</>}</p>
          {problems.length > 0 && <ul className="editor-problems">{problems.map((problem, i) => <li key={i}><code>{problem.field}</code> {problem.message}</li>)}</ul>}
          {ready && <RuleSheet variant={draft} defaultOpen label="役の順位と例" />}
        </section>}
      </main>
      <aside className="editor-sidebar" aria-label="ルールの検証">
        <div className="editor-inspector"><span className="section-kicker">構成</span><strong>{cards}<small>枚のデッキ</small></strong><dl><div><dt>手札</dt><dd>{draft.structure.holeCards} 枚</dd></div><div><dt>役の枚数</dt><dd>{draft.structure.handSize} 枚</dd></div><div><dt>最大人数</dt><dd>{seats === null ? '—' : Number.isFinite(seats) ? `${seats} 人` : '制限なし'}</dd></div></dl>
          <EditableNumber label="想定人数" value={players} min={2} max={10} suffix="人" onChange={setPlayers} />
          <p className="editor-figures">{need !== null ? `必要 ${need} 枚 / 残り ${cards - need} 枚` : '構成を確認してください'}</p>
          <button type="button" className={`validation-status ${ready ? '' : 'validation-bad'}`} onClick={() => select('check')}>{ready ? <Icon kind="check" /> : '!'} {status} <span><Icon kind="external" /></span></button>
          <p className="hint">ルールはこのブラウザに保存されます。</p>
        </div>
      </aside>
    </div>
    <footer className="editor-actions">
      <button type="button" className={`editor-status-button ${ready ? '' : 'hint-warn'}`} onClick={() => select('check')}>{ready ? <Icon kind="check" /> : '!'} {status}</button>
      {error && <p className="editor-save-error hint-warn" role="alert">{error}</p>}
      <button type="button" className="btn editor-save" disabled={!ready || bannerBusy} onClick={save}>{saved ? '保存しました' : '保存する'}</button>
      <button type="button" className="btn btn-primary" disabled={!ready || bannerBusy} onClick={() => { if (save()) onPlay(draft.id); }}>保存して卓に戻る<Icon kind="arrow-right" /></button>
    </footer>
  </div>;
}
