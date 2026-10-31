import { useCallback, useRef, useState } from 'react';
import { buildDeck, deckSize, MAX_DECK_SIZE, SUITS, type Card, type DeckRules } from '@wildcard/engine';
import { PlayingCard } from './PlayingCard.js';

const VIEWS = [['grid', '一覧'], ['overlap', '重ね'], ['arc', '扇形']] as const;
type View = (typeof VIEWS)[number][0];
const PAGE_SIZE = 130;
const CARD_W = 44;
/** 重ね：数字が隠れない 16px は見せ、入らなければ折り返す。 */
const OVERLAP = { min: 16, max: 28 };
/** 扇形：両端の札が回転ではみ出す分を左右に空ける（狭い画面では詰める）。52枚でも幅に収め、入らなければ横に伸びる。 */
const ARC = { min: 2, max: 26, side: 40, lift: 56, tilt: 36 };

interface Entry { readonly card: Card; readonly key: number }

/** 強い順。ジョーカー → ランクの強い順 → スートの順（強弱があればその順）。 */
function sortStrongestFirst(cards: readonly Card[], deck: DeckRules): Entry[] {
  const rank = new Map(deck.ranks.map((r, i) => [r, i] as const));
  const suits: readonly string[] = deck.suitRanking ?? SUITS;
  return cards.map((card, key) => ({ card, key })).sort((a, b) => {
    const ja = a.card.joker !== undefined ? 1 : 0, jb = b.card.joker !== undefined ? 1 : 0;
    if (ja !== jb) return jb - ja;
    const ra = rank.get(a.card.rank) ?? -1, rb = rank.get(b.card.rank) ?? -1;
    if (ra !== rb) return rb - ra;
    return suits.indexOf(a.card.suit) - suits.indexOf(b.card.suit);
  });
}

/** 一覧・重ねはスートごとに行を分ける（ジョーカーは先頭の行）。色の違う札を混ぜると数えにくい。 */
function rowsBySuit(entries: readonly Entry[]): Entry[][] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const suit = entry.card.joker !== undefined ? 'joker' : entry.card.suit;
    groups.set(suit, [...(groups.get(suit) ?? []), entry]);
  }
  return [...groups.values()];
}

/** 要素の幅を追う。上限超過の表示から戻ると要素が作り直されるので、ref コールバックで付け替える。 */
function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.current.observe(element);
  }, []);
  return [ref, width] as const;
}

/** Composition, never the shuffled order used by a live hand. */
export function DeckContents({ deck }: { readonly deck: DeckRules }) {
  const [view, setView] = useState<View>('grid');
  const [page, setPage] = useState(0);
  const [area, width] = useWidth();
  const size = deckSize(deck);
  if (!Number.isFinite(size) || size > MAX_DECK_SIZE) return <p className="hint hint-warn">一覧は {MAX_DECK_SIZE} 枚以内で表示できます。</p>;
  const sorted = sortStrongestFirst(buildDeck(deck), deck);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = sorted.slice(start, start + PAGE_SIZE);
  const rows = view === 'arc' ? [shown] : rowsBySuit(shown);
  return <section className="deck-contents" aria-label="デッキの構成">
    <div className="deck-contents-toolbar"><strong>{size} 枚</strong>
      <div className="chips" aria-label="カード一覧の並べ方">{VIEWS.map(([id, label]) => <button type="button" key={id}
        className={`chip ${view === id ? 'chip-on' : ''}`} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
    </div>
    <div className="deck-contents-scroll" tabIndex={0} aria-label="カード一覧">
      <div ref={area} className={`deck-contents-cards deck-contents-${view}`}>
        {rows.map((row, r) => <DeckRow key={row[0]?.card.joker !== undefined ? 'joker' : view === 'arc' ? 'all' : row[0]?.card.suit ?? r} view={view} entries={row} width={width} />)}
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

/** 行の幅に合わせて重なり幅を決める。幅が分かる前（0）は最大の間隔で出す。 */
function stepFor(count: number, width: number, range: { min: number; max: number }, side = 0): number {
  if (count < 2 || width <= 0) return range.max;
  return Math.max(range.min, Math.min(range.max, (width - CARD_W - side * 2) / (count - 1)));
}

function DeckRow({ view, entries: strongestFirst, width }: { readonly view: View; readonly entries: readonly Entry[]; readonly width: number }) {
  if (view === 'grid') return <div className="deck-contents-row">{strongestFirst.map(({ card, key }) => <span className="deck-contents-card" key={key}><PlayingCard card={card} size="sm" /></span>)}</div>;
  // 重ね・扇形は後の札が前の札に重なる。強い札が隠れないよう、弱い順に置いて強い札を一番上（右端）にする
  const entries = [...strongestFirst].reverse();
  if (view === 'overlap') {
    const step = stepFor(entries.length, width, OVERLAP);
    // 最小の重なりでも入らないときだけ折り返す
    const perLine = width > 0 ? Math.max(1, Math.floor((width - CARD_W) / step) + 1) : entries.length;
    const lines: Entry[][] = [];
    for (let i = 0; i < entries.length; i += perLine) lines.push(entries.slice(i, i + perLine));
    return <div className="deck-contents-row">{lines.map((line, l) => <div className="deck-contents-line" key={l}>
      {line.map(({ card, key }, i) => <span className="deck-contents-card" key={key} style={i === 0 ? undefined : { marginLeft: step - CARD_W }}><PlayingCard card={card} size="sm" /></span>)}
    </div>)}</div>;
  }
  // 36° 回した端の札は、回していない位置より 40px ほど外へ出る。その分を両側に空ける
  const side = ARC.side;
  const step = stepFor(entries.length, width, ARC, side);
  const rowWidth = side * 2 + CARD_W + step * Math.max(0, entries.length - 1);
  return <div className="deck-contents-row deck-contents-fan" style={{ width: Math.max(width, rowWidth), height: 6 + ARC.lift + 64 + 16 }}>
    {entries.map(({ card, key }, i) => {
      const t = entries.length < 2 ? 0 : i / (entries.length - 1) * 2 - 1;
      return <span className="deck-contents-card" key={key} style={{ left: side + i * step + Math.max(0, width - rowWidth) / 2, top: 6 + ARC.lift * t * t, transform: `rotate(${t * ARC.tilt}deg)` }}>
        <PlayingCard card={card} size="sm" /></span>;
    })}
  </div>;
}
