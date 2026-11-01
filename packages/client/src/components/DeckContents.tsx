import { useEffect, useState } from 'react';
import { MAX_DECK_SIZE, SUITS, deckSize, type Card, type DeckRules, type Rank, type Suit } from '@wildcard/engine';
import { PlayingCard, cardLabel } from './PlayingCard.js';
import { Icon } from './Icon.js';

/** そのカードが何枚入っているか。個別指定 → 共通の枚数 → 0 の順に決まる。 */
export function cardCount(deck: DeckRules, rank: Rank, suit: Suit): number {
  return [...(deck.overrides ?? [])].reverse().find(card => card.rank === rank && card.suit === suit)?.count
    ?? defaultCount(deck, rank, suit);
}

/** 個別指定が無いときの枚数。 */
const defaultCount = (deck: DeckRules, rank: Rank, suit: Suit): number =>
  deck.ranks.includes(rank) && deck.suits.includes(suit) ? deck.copies ?? 1 : 0;

/**
 * 個別の枚数を決める。null で個別指定を外し、共通の枚数に戻す。
 * 共通の枚数と同じ値にしたときも個別指定は残さない（「個別に決めた札」だけに印が付く）。
 */
export function setCardCount(deck: DeckRules, rank: Rank, suit: Suit, count: number | null): DeckRules {
  const overrides = (deck.overrides ?? []).filter(card => card.rank !== rank || card.suit !== suit);
  if (count !== null && count !== defaultCount(deck, rank, suit)) overrides.push({ rank, suit, count });
  return { ...deck, overrides };
}

const hasOverride = (deck: DeckRules, rank: Rank, suit: Suit): boolean =>
  deck.overrides?.some(card => card.rank === rank && card.suit === suit) ?? false;

type Selection = { readonly kind: 'card'; readonly rank: Rank; readonly suit: Suit } | { readonly kind: 'joker' };

const JOKER: Card = { rank: 'A', suit: 'spades', joker: 0 };
const MAX_COPIES = 99;

/**
 * デッキの構成。種類ごとに1枚ずつ、スートの行に強い順で並べる。
 *
 * 配られる順ではなく、何が何枚入っているかの一覧。0枚の札は薄く、
 * 2枚以上は右上に枚数を出す。onChange を渡すと札を押すと −／＋ が出て枚数を変えられる。
 */
export function DeckContents({ deck, onChange }: { readonly deck: DeckRules; readonly onChange?: (deck: DeckRules) => void }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const editable = onChange !== undefined;
  const size = deckSize(deck);
  const tooBig = !Number.isFinite(size) || size > MAX_DECK_SIZE;
  const ranks = [...deck.ranks].reverse();
  // 見るだけなら入っているスートだけ。編集では外したスートも並べ、1枚から足せるようにする。
  const suits = editable ? SUITS : SUITS.filter(suit => deck.ranks.some(rank => cardCount(deck, rank, suit) > 0));
  const jokers = deck.jokers ?? 0;
  const active = selected?.kind === 'card' && !deck.ranks.includes(selected.rank) ? null : selected?.kind === 'joker' && jokers === 0 ? null : selected;
  const isActive = (target: Selection) => active !== null && (active.kind === 'joker' ? target.kind === 'joker' : target.kind === 'card' && active.rank === target.rank && active.suit === target.suit);

  // 札の外を押したら閉じる。Esc でも閉じる。
  useEffect(() => {
    if (!active) return;
    const away = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.deck-contents-card[data-selected=true]')) setSelected(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [active]);

  const kind = (card: Card, count: number, target: Selection, custom: boolean, column: number, columns: number) => {
    const label = `${cardLabel(card)} ${count}枚`;
    const body = <>
      <PlayingCard card={card} size="sm" dimmed={count === 0} />
      {count > 1 && <b className="deck-count" aria-hidden="true">×{count}</b>}
    </>;
    if (!editable) return <span key={label} className="deck-contents-card" data-empty={count === 0} role="img" aria-label={label}>{body}</span>;
    const open = isActive(target);
    const set = (next: number) => onChange(target.kind === 'joker' ? { ...deck, jokers: next } : setCardCount(deck, target.rank, target.suit, next));
    return <span key={label} className="deck-contents-card" data-empty={count === 0} data-custom={custom} data-selected={open}>
      <button type="button" className="deck-contents-pick" aria-pressed={open} aria-haspopup="true" aria-label={label} onClick={() => setSelected(open ? null : target)}>{body}</button>
      {open && <span className="deck-card-popover" role="group" aria-label={`${cardLabel(card)} の枚数`} data-align={column < columns / 3 ? 'start' : column >= columns * 2 / 3 ? 'end' : 'center'}>
        <button type="button" aria-label={`${cardLabel(card)}を減らす`} disabled={count <= 0} onClick={() => set(count - 1)}><Icon kind="minus" /></button>
        <strong aria-live="polite">{count}</strong>
        <button type="button" aria-label={`${cardLabel(card)}を増やす`} disabled={count >= MAX_COPIES} onClick={() => set(count + 1)}><Icon kind="plus" /></button>
      </span>}
    </span>;
  };

  return <section className="deck-contents" aria-label="デッキの構成">
    <div className="deck-contents-toolbar"><strong className={tooBig ? 'editor-figures-bad' : ''}>{Number.isFinite(size) ? `${size} 枚` : '枚数が多すぎます'}<small>（上限 {MAX_DECK_SIZE}枚）</small></strong>{editable && <span className="hint">札を押して枚数を変えられます</span>}</div>
    {tooBig && <p className="hint hint-warn">{MAX_DECK_SIZE} 枚を超えています。</p>}
    <div className="deck-contents-cards">
      {jokers > 0 && <div className="deck-contents-row" role="group" aria-label="ジョーカー">{kind(JOKER, jokers, { kind: 'joker' }, false, 0, 1)}</div>}
      {suits.map(suit => <div key={suit} className="deck-contents-row" role="group" aria-label={cardLabel({ rank: 'A', suit }).slice(1)}>
        {ranks.map((rank, column) => kind({ rank, suit }, cardCount(deck, rank, suit), { kind: 'card', rank, suit }, hasOverride(deck, rank, suit), column, ranks.length))}
      </div>)}
      {size === 0 && <p className="hint">カードがありません。</p>}
    </div>
  </section>;
}
