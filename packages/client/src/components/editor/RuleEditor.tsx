import { useEffect, useMemo, useRef, useState } from 'react';
import { RANKS, SUITS, boardSize, deckSize, evaluationCount, maxPlayersFor, requiredCards, validateVariant, type Variant, type VariantProblem } from '@wildcard/engine';
import { Brand } from '../Brand.js';
import { Icon } from '../Icon.js';
import { RuleSheet } from '../RulePicker.js';
import { BannerEditor } from '../RuleBanner.js';
import { EditableNumber, EditableText } from '../EditableValue.js';
import { GameDialog } from '../GameDialog.js';
import { DeckEditor } from './DeckEditor.js';
import { StructureEditor } from './StructureEditor.js';
import { BettingEditor } from './BettingEditor.js';
import { RankingEditor } from './RankingEditor.js';
import { OptionsEditor } from './OptionsEditor.js';
import { ShareBox } from './ShareBox.js';
import { deleteCustomVariant, isCustomVariant, newCustomId, resolveVariant, saveCustomVariant } from '../../rules/customVariants.js';
import { ruleBanner, saveRuleBanner, type RuleBannerStyle } from '../../rules/ruleBanners.js';

interface RuleEditorProps {
  readonly source: Variant;
  /** 戻る。保存してあるルールの id を渡すと、トップでそれが選ばれる。 */
  readonly onClose: (savedId: string | null) => void;
}

/** タブ名がそのまま唯一の見出し。パネルの中では繰り返さない。 */
const SECTIONS = [
  ['info', 'ルール情報'], ['deck', 'デッキ'], ['structure', '配り方'], ['betting', '賭け方'],
  ['ranking', '役の強さ'], ['options', '卓の作法'], ['share', '受け渡し'],
] as const;
type Section = typeof SECTIONS[number][0];

/** 矛盾の field（例: structure.holeCards）から、直せるタブを引く。 */
function sectionOf(field: string): Section {
  const head = field.split(/[.[]/)[0];
  return head === 'deck' || head === 'structure' || head === 'betting' || head === 'ranking' || head === 'options' ? head : 'info';
}
const sectionLabel = (section: Section): string => SECTIONS.find(([id]) => id === section)?.[1] ?? '';

type Leaving = 'none' | 'confirm' | 'delete';

export function RuleEditor({ source, onClose }: RuleEditorProps) {
  const [draft, setDraft] = useState<Variant>(() => isCustomVariant(source.id) ? source : { ...source, id: newCustomId(), name: `${source.name}の写し` });
  const [banner, setBanner] = useState<RuleBannerStyle>(() => ruleBanner(source.id));
  // 最後に保存した（または開いた）状態。これと違えば「未保存の変更あり」。
  const [baseline, setBaseline] = useState<{ readonly variant: Variant; readonly banner: RuleBannerStyle }>(() => ({ variant: draft, banner }));
  const [persisted, setPersisted] = useState(() => isCustomVariant(source.id));
  const [section, setSection] = useState<Section>('info');
  const [players, setPlayers] = useState(6);
  const [error, setError] = useState('');
  const [bannerBusy, setBannerBusy] = useState(false);
  const [leaving, setLeaving] = useState<Leaving>('none');
  const [preview, setPreview] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const header = useRef<HTMLElement>(null);

  const problems = useMemo(() => validateVariant(draft, players), [draft, players]);
  const ready = problems.length === 0 && draft.name.trim().length > 0;
  const dirty = draft !== baseline.variant && JSON.stringify(draft) !== JSON.stringify(baseline.variant)
    || banner !== baseline.banner && JSON.stringify(banner) !== JSON.stringify(baseline.banner);
  const canSave = ready && !bannerBusy && (dirty || !persisted);
  const update = (patch: Partial<Variant>) => { setDraft(current => ({ ...current, ...patch })); setError(''); };

  const save = (): boolean => {
    if (!ready || bannerBusy) return false;
    if (!saveCustomVariant(draft) || !saveRuleBanner(draft.id, banner)) {
      setError('保存できませんでした。ブラウザの保存容量・設定を確認してください。');
      return false;
    }
    setBaseline({ variant: draft, banner }); setPersisted(true); setError('');
    return true;
  };
  const leave = () => onClose(persisted ? draft.id : null);
  const back = () => { if (dirty) setLeaving('confirm'); else leave(); };
  const jump = (next: Section) => { setSection(next); setInspecting(false); };

  // タブを閉じる・再読み込みでも、未保存の変更を黙って捨てない。
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const cards = deckSize(draft.deck);
  const need = problems.length === 0 ? requiredCards(draft.structure, players) : null;
  const seats = problems.length === 0 ? maxPlayersFor(draft) : null;
  const status = problems.length > 0 ? `要確認 ${problems.length}件` : !draft.name.trim() ? '名前を入力してください' : '設定に矛盾なし';
  const inspector = <Inspector cards={cards} draft={draft} players={players} onPlayers={setPlayers} need={need} seats={seats}
    problems={problems} ready={ready} status={status} onJump={jump} onPreview={() => { setInspecting(false); setPreview(true); }} />;

  return <div className="screen screen-editor rules-shell">
    <header ref={header} className="setup-header editor-head">
      <Brand />
      <div className="editor-head-actions">
        {isCustomVariant(source.id) && <button type="button" className="btn btn-ghost editor-delete" onClick={() => setLeaving('delete')}>削除</button>}
        <button type="button" className="btn btn-ghost btn-back" onClick={back}><Icon kind="arrow-left" />戻る</button>
        <button type="button" className="btn btn-primary editor-save" disabled={!canSave} onClick={save}>{persisted && !dirty ? '保存済み' : '保存'}</button>
      </div>
    </header>
    <div className="editor-heading">
      <div><h1 className="editor-title">ルールを設定</h1><p className="editor-current-name">{draft.name}</p></div>
      <button type="button" className={`editor-summary ${ready ? '' : 'editor-summary-bad'}`} aria-haspopup="dialog" aria-expanded={inspecting} onClick={() => setInspecting(true)}>
        <span>{cards}枚 · 手札{draft.structure.holeCards} · 場{boardSize(draft.structure)}{seats !== null && Number.isFinite(seats) && ` · 最大${seats}人`}</span>
        <strong>{ready ? <Icon kind="check" /> : '!'} {status}</strong>
      </button>
    </div>
    {error && <p className="editor-save-error hint-warn" role="alert">{error}</p>}
    <div className="editor-workspace">
      <nav className="editor-nav" role="tablist" aria-label="ルールの編集項目">
        {SECTIONS.map(([id, label], i) => <button key={id} type="button" role="tab" aria-selected={section === id} id={`rules-tab-${id}`} aria-controls="rules-panel" onClick={() => setSection(id)}>
          <span>{String(i + 1).padStart(2, '0')}</span>{label}{problems.some(problem => sectionOf(problem.field) === id) && <i aria-label="要確認">!</i>}
        </button>)}
      </nav>
      <main className="editor-content" id="rules-panel" role="tabpanel" aria-labelledby={`rules-tab-${section}`} key={section}>
        {section === 'info' && <section className="panel" id="rules-info" aria-label="ルール情報">
          <EditableText label="名前" value={draft.name} maxLength={40} onChange={name => update({ name })} />
          <EditableText label="説明" value={draft.description ?? ''} maxLength={120} multiline placeholder="説明を追加" onChange={description => update({ description })} />
          <div className="field"><span className="field-label">選択画面のバナー</span><BannerEditor variant={draft} value={banner} onBusyChange={setBannerBusy} onChange={value => { setBanner(value); setError(''); }} /></div>
        </section>}
        {section === 'deck' && <DeckEditor deck={draft.deck} allRanks={RANKS} allSuits={SUITS} onChange={deck => update({ deck })} />}
        {section === 'structure' && <StructureEditor structure={draft.structure} onChange={structure => update({ structure })} />}
        {section === 'betting' && <BettingEditor betting={draft.betting} structure={draft.structure} onChange={betting => update({ betting })} />}
        {section === 'ranking' && <RankingEditor variant={draft} onChange={ranking => update({ ranking })} />}
        {section === 'options' && <OptionsEditor options={draft.options} onChange={options => update({ options })} />}
        {section === 'share' && <ShareBox variant={draft} onImported={id => {
          const imported = resolveVariant(id);
          if (!imported) return;
          const importedBanner = ruleBanner(id);
          setDraft(imported); setBanner(importedBanner); setBaseline({ variant: imported, banner: importedBanner }); setPersisted(true); setSection('info');
        }} />}
      </main>
      <aside className="editor-sidebar" aria-label="ルールの検証">{inspector}</aside>
    </div>
    {inspecting && <GameDialog title="構成と検証" className="editor-inspector-dialog" anchor={header.current} placement="under" onClose={() => setInspecting(false)}>{inspector}</GameDialog>}
    {preview && <GameDialog title={draft.name} className="setup-rule-dialog" anchor={header.current} placement="under" onClose={() => setPreview(false)}><RuleSheet variant={draft} frame={false} /></GameDialog>}
    {leaving === 'confirm' && <GameDialog title="変更を保存しますか" className="editor-leave-dialog" onClose={() => setLeaving('none')}>
      <p className="hint">保存していない変更があります。{!ready && 'いまの設定は矛盾があるので保存できません。'}</p>
      <div className="editor-leave-actions">
        <button type="button" className="btn btn-primary" disabled={!ready || bannerBusy} onClick={() => { if (save()) onClose(draft.id); }}>保存して戻る</button>
        <button type="button" className="btn btn-danger" onClick={leave}>保存せずに戻る</button>
      </div>
    </GameDialog>}
    {leaving === 'delete' && <GameDialog title="このルールを削除しますか" className="editor-leave-dialog" onClose={() => setLeaving('none')}>
      <p className="hint">「{draft.name}」をこのブラウザから消します。元に戻せません。</p>
      <div className="editor-leave-actions">
        <button type="button" className="btn btn-danger" onClick={() => { if (deleteCustomVariant(draft.id)) onClose(null); else { setLeaving('none'); setError('ルールを削除できませんでした。'); } }}>削除する</button>
      </div>
    </GameDialog>}
  </div>;
}

/**
 * 構成の要約と検証。大画面では右の欄に常駐し、スマホでは見出し下の要約を押すと開く。
 * 想定人数と矛盾の表示はここだけに置く。
 */
/** これを超えると CPU の勝率推定が目に見えて遅くなる（標準は 21 通り、オマハは 60 通り）。 */
const HEAVY_EVALUATIONS = 3000;

function Inspector({ cards, draft, players, onPlayers, need, seats, problems, ready, status, onJump, onPreview }: {
  readonly cards: number; readonly draft: Variant; readonly players: number; readonly onPlayers: (value: number) => void;
  readonly need: number | null; readonly seats: number | null; readonly problems: readonly VariantProblem[];
  readonly ready: boolean; readonly status: string; readonly onJump: (section: Section) => void; readonly onPreview: () => void;
}) {
  const evaluations = evaluationCount(draft.structure, draft.structure.holeCards, boardSize(draft.structure));
  return <div className="editor-inspector">
    <span className="section-kicker">構成</span>
    <strong>{cards}<small>枚のデッキ</small></strong>
    <dl><div><dt>手札</dt><dd>{draft.structure.holeCards} 枚</dd></div><div><dt>場</dt><dd>{boardSize(draft.structure)} 枚</dd></div><div><dt>役の枚数</dt><dd>{draft.structure.handSize} 枚</dd></div><div><dt>最大人数</dt><dd>{seats === null ? '—' : Number.isFinite(seats) ? `${seats} 人` : '制限なし'}</dd></div></dl>
    <EditableNumber label="想定人数" value={players} min={2} max={10} suffix="人" onChange={onPlayers} />
    <p className="editor-figures">{need !== null ? `必要 ${need} 枚 / 残り ${cards - need} 枚` : '構成を確認してください'}</p>
    {evaluations > HEAVY_EVALUATIONS && <p className="editor-figures editor-figures-bad">役の判定が1手 {evaluations.toLocaleString()} 通り。CPU の判断が遅くなります。</p>}
    <p className={`validation-status ${ready ? '' : 'validation-bad'}`} role="status">{ready ? <Icon kind="check" /> : '!'} {status}</p>
    {problems.length > 0 && <ul className="editor-problems">{problems.map((problem, i) => {
      const section = sectionOf(problem.field);
      return <li key={i}><button type="button" onClick={() => onJump(section)}><span>{sectionLabel(section)}</span>{problem.message}</button></li>;
    })}</ul>}
    <button type="button" className="btn btn-muted editor-preview" disabled={!ready} onClick={onPreview}>役の順位と例<Icon kind="external" /></button>
    <p className="hint">ルールはこのブラウザに保存されます。</p>
  </div>;
}
