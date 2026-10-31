import { useState, type CSSProperties } from 'react';
import { buildDeck, deckSize, MAX_DECK_SIZE, SUITS, type Card, type DeckRules } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';

const VIEWS = [['grid', '一覧'], ['overlap', '重ね'], ['arc', '扇形']] as const;
const PAGE_SIZE = 52;
/** 行の順。スート順で並べ、ジョーカーは最後にまとめる。 */
const ROW_ORDER: readonly string[] = [...SUITS, 'joker'];

/** スート（ジョーカーは別枠）ごとに1行へ分ける。色の違う札を同じ列に混ぜると数えにくい。 */
function rowsBySuit(cards: readonly Card[]): readonly (readonly [string, readonly { card: Card; index: number }[]])[] {
  const groups = new Map<string, { card: Card; index: number }[]>();
  cards.forEach((card, index) => {
    const key = card.joker !== undefined ? 'joker' : card.suit;
    const group = groups.get(key) ?? [];
    group.push({ card, index });
    groups.set(key, group);
  });
  return ROW_ORDER.filter(key => groups.has(key)).map(key => [key, groups.get(key)!] as const);
}

/** Composition, never the shuffled order used by a live hand. */
export function DeckContents({ deck }: { readonly deck: DeckRules }) {
  const [view, setView] = useState<(typeof VIEWS)[number][0]>('grid');
  const [page, setPage] = useState(0);
  const size = deckSize(deck);
  if (!Number.isFinite(size) || size > MAX_DECK_SIZE) return <p className="hint hint-warn">一覧は {MAX_DECK_SIZE} 枚以内で表示できます。</p>;
  const cards = buildDeck(deck);
  const pages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = cards.slice(start, start + PAGE_SIZE);
  return <section className="deck-contents" aria-label="デッキの構成">
    <div className="deck-contents-toolbar"><strong>{size} 枚</strong>
      <div className="chips" aria-label="カード一覧の並べ方">{VIEWS.map(([id, label]) => <button type="button" key={id}
        className={`chip ${view === id ? 'chip-on' : ''}`} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
    </div>
    <div className="deck-contents-scroll" tabIndex={0} aria-label="カード一覧">
      <div className={`deck-contents-cards deck-contents-${view}`}>
        {rowsBySuit(shown).map(([suit, items]) =>
          <div className="deck-contents-row" key={suit} data-suit={suit} style={{ '--n': items.length } as CSSProperties}>
            {items.map(({ card, index }, i) => {
              // 扇形では -1〜1 の位置 t から角度と高さを CSS 側で決める
              const t = items.length < 2 ? 0 : i / (items.length - 1) * 2 - 1;
              return <span className="deck-contents-card" key={start + index}
                style={view === 'arc' ? { '--i': i, '--t': t } as CSSProperties : undefined}><PlayingCard card={card} size="sm" /></span>;
            })}
          </div>)}
      </div>
      {size === 0 && <p className="hint">カードがありません。</p>}
    </div>
    {pages > 1 && <div className="deck-pagination">
      <button type="button" className="btn btn-ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>前へ</button>
      <span>{start + 1}–{start + shown.length} / {size} 枚</span>
      <button type="button" className="btn btn-ghost" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>次へ</button>
    </div>}
  </section>;
}
