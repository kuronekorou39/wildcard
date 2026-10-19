import { useMemo, useState } from 'react';
import {
  RANKS,
  SUITS,
  deckSize,
  maxPlayersFor,
  requiredCards,
  validateVariant,
  type Variant,
} from '@wildcard/engine';
import { RuleSheet } from '../RulePicker.js';
import { DeckEditor } from './DeckEditor.js';
import { StructureEditor } from './StructureEditor.js';
import { RankingEditor } from './RankingEditor.js';
import { OptionsEditor } from './OptionsEditor.js';
import { ShareBox } from './ShareBox.js';
import {
  deleteCustomVariant,
  isCustomVariant,
  newCustomId,
  saveCustomVariant,
} from '../../rules/customVariants.js';

interface RuleEditorProps {
  /** 元にするルール。プリセットを渡すと「これを元に作る」になる。 */
  readonly source: Variant;
  readonly onClose: () => void;
  /** 保存したルールで遊ぶ。 */
  readonly onPlay: (variantId: string) => void;
}

/**
 * ルールの編集画面。
 *
 * **Wildcard の主役。** 遊ぶ画面はこれを確かめるための場所でもある。
 *
 * 作りの要点:
 *
 * 1. 編集中の値は Variant そのもの。画面用の中間表現を持たない。
 *    旧 poker-web-20250702 の HouseRulesPage.tsx が 3,651行で力尽きたのは、
 *    画面の状態とルールの表現が別物で、相互変換を書き続けたためだった。
 * 2. 矛盾は validateVariant に聞く。画面側に判定を書かない。
 * 3. **作ったものをその場で見せる。** 条件式だけでは何が成立するのか分からない。
 *    成立する手の例を出す（→ engine の example.ts）。
 */
export function RuleEditor({ source, onClose, onPlay }: RuleEditorProps) {
  // プリセットを元にしたときは、別物として新しい id を振る。
  // プリセットを上書きできてしまうと、元に戻せなくなる。
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

  const save = () => {
    saveCustomVariant(draft);
    setSaved(true);
  };

  const remove = () => {
    deleteCustomVariant(draft.id);
    onClose();
  };

  const cards = deckSize(draft.deck);
  const need = ready ? requiredCards(draft.structure, players) : null;
  const seats = ready ? maxPlayersFor(draft) : 0;

  return (
    <div className="screen screen-editor">
      <header className="editor-head">
        <button type="button" className="btn btn-ghost btn-back" onClick={onClose}>
          ← 戻る
        </button>
        <h1 className="editor-title">ルールを作る</h1>
      </header>

      <section className="panel">
        <label className="field">
          <span className="field-label">名前</span>
          <input
            className="input"
            value={draft.name}
            maxLength={24}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">説明（遊ぶ前に読まれる一行）</span>
          <input
            className="input"
            value={draft.description ?? ''}
            maxLength={120}
            placeholder="何が標準と違うのか"
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
      </section>

      <DeckEditor
        deck={draft.deck}
        allRanks={RANKS}
        allSuits={SUITS}
        onChange={(deck) => update({ deck })}
      />

      <StructureEditor
        structure={draft.structure}
        onChange={(structure) => update({ structure })}
      />

      <RankingEditor
        variant={draft}
        onChange={(ranking) => update({ ranking })}
      />

      <OptionsEditor
        options={draft.options}
        onChange={(options) => update({ options })}
      />

      <section className="panel">
        <h2 className="panel-title">確かめる</h2>
        <label className="field">
          <span className="field-label">何人で遊ぶ想定か（{players}人）</span>
          <input
            className="range"
            type="range"
            min={2}
            max={10}
            value={players}
            onChange={(e) => setPlayers(Number(e.target.value))}
          />
        </label>

        <p className="editor-figures">
          デッキ {cards}枚
          {need !== null && (
            <>
              {' ／ '}
              {players}人で必要 {need}枚
              {' ／ '}
              最大 {Number.isFinite(seats) ? `${seats}人` : '制限なし'}
            </>
          )}
        </p>

        {problems.length > 0 ? (
          <ul className="editor-problems">
            {problems.map((problem, i) => (
              <li key={i}>
                <code>{problem.field}</code> {problem.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="editor-ok">矛盾はありません。</p>
        )}
      </section>

      {ready && (
        <section className="panel">
          <h2 className="panel-title">できあがり</h2>
          <p className="panel-note">
            条件だけでは何が成立するのか分かりません。実際に成立する手を出します。
          </p>
          <RuleSheet variant={draft} label="役の順位と例を見る" />
        </section>
      )}

      <ShareBox variant={draft} />

      <div className="editor-actions">
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={save}>
          {saved ? '保存しました' : '保存する'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!ready}
          onClick={() => {
            save();
            onPlay(draft.id);
          }}
        >
          この卓で遊ぶ
        </button>
        <button type="button" className="btn btn-danger" onClick={remove}>
          削除
        </button>
      </div>
    </div>
  );
}
