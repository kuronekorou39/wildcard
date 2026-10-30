import { EditableNumber } from '../EditableValue.js';
import { DeckCards } from './DeckCards.js';
import { useState } from 'react';
import { MAX_DECK_SIZE, deckSize, type DeckRules, type Rank, type Suit } from '@wildcard/engine';

const SUIT_LABEL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

interface DeckEditorProps {
  readonly deck: DeckRules;
  readonly allRanks: readonly Rank[];
  readonly allSuits: readonly Suit[];
  readonly onChange: (deck: DeckRules) => void;
}

/**
 * デッキの編集。
 *
 * ここで効く設計上の点が2つある。
 *
 * - **ランクの並び順がそのまま強さ**になる。並べ替えると「TT が AA より強い」が
 *   作れる代わりに、9-10-J-Q-K が連続でなくなる。その警告を画面に出す。
 * - 枚数は数字の入力一つで際限なく増える。上限を超えたら札を作らずに止める
 *   （deckSize は数えるだけで、buildDeck と違って確保しない）。
 */
export function DeckEditor({ deck, allRanks, allSuits, onChange }: DeckEditorProps) {
  const size = deckSize(deck);
  const [editingOrder, setEditingOrder] = useState(false);

  const toggleSuit = (suit: Suit) => {
    const next = deck.suits.includes(suit)
      ? deck.suits.filter((s) => s !== suit)
      : [...allSuits.filter((s) => deck.suits.includes(s) || s === suit)];
    onChange({ ...deck, suits: next, overrides: deck.suits.includes(suit) ? (deck.overrides ?? []).filter(card => card.suit !== suit) : deck.overrides ?? [] });
  };

  const toggleRank = (rank: Rank) => {
    const next = deck.ranks.includes(rank)
      ? deck.ranks.filter((r) => r !== rank)
      : // 元の並びの位置へ戻す。付け足すと強さの順序が変わってしまう。
        allRanks.filter((r) => deck.ranks.includes(r) || r === rank);
    onChange({ ...deck, ranks: next, overrides: deck.ranks.includes(rank) ? (deck.overrides ?? []).filter(card => card.rank !== rank) : deck.overrides ?? [] });
  };

  const moveRank = (at: number, by: number) => {
    const to = at + by;
    if (to < 0 || to >= deck.ranks.length) return;
    const next = [...deck.ranks];
    const moved = next[at]!;
    next[at] = next[to]!;
    next[to] = moved;
    onChange({ ...deck, ranks: next });
  };

  return (
    <section className="panel">
      <h2 className="panel-title">デッキ</h2>

      <div className="field">
        <span className="field-label">スート（外すと丸ごと消える）</span>
        <div className="chips">
          {allSuits.map((suit) => (
            <button
              key={suit}
              type="button"
              className={`chip ${deck.suits.includes(suit) ? 'chip-on' : ''} ${
                suit === 'hearts' || suit === 'diamonds' ? 'chip-red' : ''
              }`}
              onClick={() => toggleSuit(suit)}
            >
              {SUIT_LABEL[suit]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">使うランク</span>
        <div className="chips">
          {allRanks.map((rank) => (
            <button
              key={rank}
              type="button"
              className={`chip ${deck.ranks.includes(rank) ? 'chip-on' : ''}`}
              onClick={() => toggleRank(rank)}
            >
              {rank}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">強さの順（左が弱い）</span>
        {!editingOrder ? <button type="button" className="rank-order-preview" aria-label="ランクの強さを編集" onClick={() => setEditingOrder(true)}>{deck.ranks.map(rank => <span key={rank}>{rank}</span>)}<small>編集 ↗</small></button> : <>
        <div className="rank-order">
          {deck.ranks.map((rank, i) => (
            <div key={rank} className="rank-order-item">
              <button
                type="button"
                className="rank-order-arrow"
                aria-label={`${rank} を弱くする`}
                disabled={i === 0}
                onClick={() => moveRank(i, -1)}
              >
                ‹
              </button>
              <span className="rank-order-rank">{rank}</span>
              <button
                type="button"
                className="rank-order-arrow"
                aria-label={`${rank} を強くする`}
                disabled={i === deck.ranks.length - 1}
                onClick={() => moveRank(i, 1)}
              >
                ›
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setEditingOrder(false)}>並べ替えを完了</button>
        </>}
        <details className="editor-note"><summary>強さとストレートの関係</summary><p className="hint">
          並びがそのまま強さです。10 を A の上に動かせば「TT が AA より強い」になりますが、
          9-10-J-Q-K は連続でなくなります（ストレートの意味も変わります）。
        </p></details>
      </div>

      <div className="field-row">
        <EditableNumber label="各カードの枚数" value={deck.copies ?? 1} min={0} max={99} onChange={copies => onChange({ ...deck, copies })} />
        <EditableNumber label="ジョーカー" value={deck.jokers ?? 0} min={0} max={99} onChange={jokers => onChange({ ...deck, jokers })} />
      </div>

      <DeckCards deck={deck} suits={allSuits} onChange={onChange} />

      <label className="checkline">
        <input
          type="checkbox"
          checked={deck.suitRanking !== undefined}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { ...deck, suitRanking: [...allSuits] }
                : omit(deck, 'suitRanking'),
            )
          }
        />
        <span>
          スートに強弱をつける
          <small className="checkline-note">
            同じランクで並んだときの決着に使います。付けないと引き分け（チョップ）。
          </small>
        </span>
      </label>

      {deck.suitRanking !== undefined && (
        <div className="field">
          <span className="field-label">スートの強さ（左が強い）</span>
          <div className="chips">
            {deck.suitRanking.map((suit, i) => (
              <button
                key={suit}
                type="button"
                className={`chip chip-on ${suit === 'hearts' || suit === 'diamonds' ? 'chip-red' : ''}`}
                aria-label={`${SUIT_LABEL[suit]} を弱くする`}
                onClick={() => {
                  if (i === 0) return;
                  const next = [...deck.suitRanking!];
                  next[i] = next[i - 1]!;
                  next[i - 1] = suit;
                  onChange({ ...deck, suitRanking: next });
                }}
              >
                {SUIT_LABEL[suit]}
              </button>
            ))}
          </div>
          <p className="hint">押すと1つ強くなります。</p>
        </div>
      )}

      <p className={`editor-figures ${size > MAX_DECK_SIZE ? 'editor-figures-bad' : ''}`}>
        {size}枚（上限 {MAX_DECK_SIZE}枚）
      </p>
    </section>
  );
}


function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
