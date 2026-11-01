import { useState } from 'react';
import { MAX_DECK_SIZE, SUITS, deckSize, type Card, type DeckRules, type Rank, type Suit } from '@wildcard/engine';
import { PlayingCard, cardLabel } from './PlayingCard.js';
import { EditableNumber } from './EditableValue.js';

/** そのカードが何枚入っているか。個別指定 → 共通の枚数 → 0 の順に決まる。 */
export function cardCount(deck: DeckRules, rank: Rank, suit: Suit): number {
  return [...(deck.overrides ?? [])].reverse().find(card => card.rank === rank && card.suit === suit)?.count
    ?? (deck.ranks.includes(rank) && deck.suits.includes(suit) ? deck.copies ?? 1 : 0);
}

/** 個別の枚数を決める。null で個別指定を外し、共通の枚数に戻す。 */
export function setCardCount(deck: DeckRules, rank: Rank, suit: Suit, count: number | null): DeckRules {
  const overrides = (deck.overrides ?? []).filter(card => card.rank !== rank || card.suit !== suit);
  if (count !== null) overrides.push({ rank, suit, count });
  return { ...deck, overrides };
}

const hasOverride = (deck: DeckRules, rank: Rank, suit: Suit): boolean =>
  deck.overrides?.some(card => card.rank === rank && card.suit === suit) ?? false;

type Selection = { readonly kind: 'card'; readonly rank: Rank; readonly suit: Suit } | { readonly kind: 'joker' };

const JOKER: Card = { rank: 'A', suit: 'spades', joker: 0 };

/**
 * デッキの構成。種類ごとに1枚ずつ、スートの行に強い順で並べる。
 *
 * 配られる順ではなく、何が何枚入っているかの一覧。0枚の札は薄く、
 * 2枚以上は右上に枚数を出す。onChange を渡すと札を押して枚数を変えられる。
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
  const active = selected?.kind === 'card' && !deck.ranks.includes(selected.rank) ? null : selected;
  const isActive = (target: Selection) => active !== null && (active.kind === 'joker' ? target.kind === 'joker' : target.kind === 'card' && active.rank === target.rank && active.suit === target.suit);

  const kind = (card: Card, count: number, target: Selection, custom: boolean) => {
    const label = `${cardLabel(card)} ${count}枚`;
    const body = <>
      <PlayingCard card={card} size="sm" dimmed={count === 0} />
      {count !== 1 && <b className="deck-count" aria-hidden="true">{count === 0 ? '0' : `×${count}`}</b>}
    </>;
    if (!editable) return <span key={label} className="deck-contents-card" data-empty={count === 0} role="img" aria-label={label}>{body}</span>;
    return <button key={label} type="button" className="deck-contents-card" data-empty={count === 0} data-custom={custom} aria-pressed={isActive(target)} aria-label={label}
      onClick={() => setSelected(isActive(target) ? null : target)}>{body}</button>;
  };

  return <section className="deck-contents" aria-label="デッキの構成">
    <div className="deck-contents-toolbar"><strong className={tooBig ? 'editor-figures-bad' : ''}>{Number.isFinite(size) ? `${size} 枚` : '枚数が多すぎます'}<small>（上限 {MAX_DECK_SIZE}枚）</small></strong>{editable && <span className="hint">札を押して枚数を変えられます</span>}</div>
    {tooBig && <p className="hint hint-warn">{MAX_DECK_SIZE} 枚を超えています。</p>}
    <div className="deck-contents-cards">
      {jokers > 0 && <div className="deck-contents-row" role="group" aria-label="ジョーカー">{kind(JOKER, jokers, { kind: 'joker' }, false)}</div>}
      {suits.map(suit => <div key={suit} className="deck-contents-row" role="group" aria-label={cardLabel({ rank: 'A', suit }).slice(1)}>
        {ranks.map(rank => kind({ rank, suit }, cardCount(deck, rank, suit), { kind: 'card', rank, suit }, hasOverride(deck, rank, suit)))}
      </div>)}
      {size === 0 && <p className="hint">カードがありません。</p>}
    </div>
    {editable && active && <div className="deck-card-count" key={active.kind === 'joker' ? 'joker' : `${active.rank}/${active.suit}`}>
      {active.kind === 'joker'
        ? <EditableNumber label="ジョーカーの枚数" value={jokers} min={0} max={99} onChange={count => onChange({ ...deck, jokers: count })} />
        : <>
          <EditableNumber label={`${cardLabel(active)} の枚数`} value={cardCount(deck, active.rank, active.suit)} min={0} max={99}
            onChange={count => onChange(setCardCount(deck, active.rank, active.suit, count))} />
          <button type="button" className="btn btn-ghost" disabled={!hasOverride(deck, active.rank, active.suit)}
            onClick={() => onChange(setCardCount(deck, active.rank, active.suit, null))}>共通の枚数に戻す</button>
        </>}
    </div>}
    {editable && <p className="hint">0枚で除外します。個別の枚数は共通の枚数より優先されます。</p>}
  </section>;
}
