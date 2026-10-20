import { useMemo, useState } from 'react';
import {
  RANKS, SUITS, deckSize, maxPlayersFor, requiredCards, validateVariant, type Variant,
} from '@wildcard/engine';
import { Brand, CharacterMark } from '../Brand.js';
import { RuleSheet } from '../RulePicker.js';
import { DeckEditor } from './DeckEditor.js';
import { StructureEditor } from './StructureEditor.js';
import { BettingEditor } from './BettingEditor.js';
import { RankingEditor } from './RankingEditor.js';
import { OptionsEditor } from './OptionsEditor.js';
import { ShareBox } from './ShareBox.js';
import {
  deleteCustomVariant, isCustomVariant, newCustomId, resolveVariant, saveCustomVariant,
} from '../../rules/customVariants.js';

interface RuleEditorProps {
  /** プリセットから作る場合は、新しいIDで保存する。 */
  readonly source: Variant;
  readonly onClose: () => void;
  readonly onPlay: (variantId: string) => void;
}

/** 編集中の値は Variant 自体。条件の検証と成立する手の例はエンジンが決める。 */
export function RuleEditor({ source, onClose, onPlay }: RuleEditorProps) {
  const [draft, setDraft] = useState<Variant>(() =>
    isCustomVariant(source.id)
      ? source
      : { ...source, id: newCustomId(), name: `${source.name}（写し）` },
  );
  const [players, setPlayers] = useState(6);
  const [saved, setSaved] = useState(false);
  const problems = useMemo(() => validateVariant(draft, players), [draft, players]);
  const ready = problems.length === 0;

  const update = (patch: Partial<Variant>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const save = () => { saveCustomVariant(draft); setSaved(true); };
  const remove = () => { deleteCustomVariant(draft.id); onClose(); };
  const cards = deckSize(draft.deck);
  const need = ready ? requiredCards(draft.structure, players) : null;
  const seats = ready ? maxPlayersFor(draft) : 0;

  return (
    <div className="screen screen-editor">
      <header className="editor-head">
        <button type="button" className="btn btn-ghost btn-back" onClick={onClose}>← 戻る</button>
        <Brand compact />
      </header>
      <div className="editor-heading">
        <p className="eyebrow">MAKE YOUR HOUSE RULES</p>
        <h1 className="editor-title">ルールを作る</h1>
        <p>いつものポーカーを、自分たちらしく。</p>
      </div>
      <div className="editor-workspace">
        <nav className="editor-nav" aria-label="ルールの編集項目">
          <a href="#rules-info">ルール情報</a><a href="#rules-deck">デッキ</a>
          <a href="#rules-structure">配り方</a><a href="#rules-betting">ベット</a>
          <a href="#rules-ranking">役の強さ</a><a href="#rules-options">卓の作法</a>
          <a href="#rules-share">受け渡し</a><a href="#rules-check">確かめる</a>
        </nav>
        <main className="editor-content">
          <section className="panel" id="rules-info">
            <h2 className="panel-title">ルール情報</h2>
            <label className="field">
              <span className="field-label">名前</span>
              <input className="input" value={draft.name} maxLength={24} onChange={(e) => update({ name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">説明（遊ぶ前に読まれる一行）</span>
              <input className="input" value={draft.description ?? ''} maxLength={120} placeholder="何が標準と違うのか" onChange={(e) => update({ description: e.target.value })} />
            </label>
          </section>
          <div id="rules-deck"><DeckEditor deck={draft.deck} allRanks={RANKS} allSuits={SUITS} onChange={(deck) => update({ deck })} /></div>
          <div id="rules-structure"><StructureEditor structure={draft.structure} onChange={(structure) => update({ structure })} /></div>
          <div id="rules-betting"><BettingEditor betting={draft.betting} structure={draft.structure} onChange={(betting) => update({ betting })} /></div>
          <div id="rules-ranking"><RankingEditor variant={draft} onChange={(ranking) => update({ ranking })} /></div>
          <div id="rules-options"><OptionsEditor options={draft.options} onChange={(options) => update({ options })} /></div>
          {ready && (
            <section className="panel">
              <h2 className="panel-title">できあがり</h2>
              <p className="panel-note">このルールで成立する手を、実際のカードで確かめよう。</p>
              <RuleSheet variant={draft} label="役の順位と例を見る" />
            </section>
          )}
          <div id="rules-share">
            <ShareBox variant={draft} onImported={(id) => {
              // 内容を確認してから、遊ぶ画面へ進む。
              const imported = resolveVariant(id);
              if (imported) { setDraft(imported); setSaved(true); }
            }} />
          </div>
        </main>
        <aside className="editor-sidebar" aria-label="ルールの検証と保存">
          <section className="panel editor-validation" id="rules-check">
            <p className="eyebrow">YOUR TABLE</p>
            <h2 className="panel-title">確かめる</h2>
            <p className="editor-draft-name">{draft.name}</p>
            <label className="field">
              <span className="field-label">何人で遊ぶ想定か（{players}人）</span>
              <input className="range" type="range" min={2} max={10} value={players} onChange={(e) => setPlayers(Number(e.target.value))} />
            </label>
            <p className="editor-figures">
              デッキ {cards}枚
              {need !== null && <> ／ {players}人で必要 {need}枚 ／ 最大 {Number.isFinite(seats) ? `${seats}人` : '制限なし'}</>}
            </p>
            <div aria-live="polite">
              {problems.length > 0 ? (
                <ul className="editor-problems">
                  {problems.map((problem, i) => <li key={i}><code>{problem.field}</code> {problem.message}</li>)}
                </ul>
              ) : <p className="editor-ok">✓ 矛盾はありません。</p>}
            </div>
            <div className="editor-helper"><CharacterMark /><span>仲間に合わせて、<br />少しずつ変えていこう。</span></div>
          </section>
          <div className="editor-actions">
            {!ready && <a className="editor-error-link" href="#rules-check">設定を確認してください（{problems.length}件） →</a>}
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>{saved ? '保存しました' : '保存する'}</button>
            <button type="button" className="btn" disabled={!ready} onClick={() => { save(); onPlay(draft.id); }}>この卓で遊ぶ</button>
            <button type="button" className="btn btn-danger" onClick={remove}>削除</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
