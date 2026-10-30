import { useState } from 'react';
import { buildDeck, deckSize, MAX_DECK_SIZE, type DeckRules } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';

const VIEWS = [['grid', '一覧'], ['overlap', '重ねる'], ['arc', '扇形']] as const;
const PAGE_SIZE = 52;

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
      <div className={`deck-contents-cards deck-contents-${view}`} style={view === 'grid' ? undefined : { width: Math.max(80, (shown.length - 1) * 26 + 72) }}>
        {shown.map((card, i) => {
          const t = shown.length < 2 ? 0 : i / (shown.length - 1) * 2 - 1;
          return <span className="deck-contents-card" key={start + i} style={view === 'grid' ? undefined : {
            left: 16 + i * 26, top: view === 'arc' ? 12 + 28 * t * t : 20,
            transform: view === 'arc' ? `rotate(${t * 20}deg)` : undefined,
          }}><PlayingCard card={card} size="sm" /></span>;
        })}
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
