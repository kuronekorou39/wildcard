import { useState } from 'react';
import type { DeckRules, Rank, Suit } from '@wildcard/engine';
import { EditableNumber } from '../EditableValue.js';
import { DeckContents } from '../DeckContents.js';
import { cardLabel } from '../PlayingCard.js';

export function cardCount(deck: DeckRules, rank: Rank, suit: Suit): number {
  return [...(deck.overrides ?? [])].reverse().find(card => card.rank === rank && card.suit === suit)?.count
    ?? (deck.ranks.includes(rank) && deck.suits.includes(suit) ? deck.copies ?? 1 : 0);
}

export function setCardCount(deck: DeckRules, rank: Rank, suit: Suit, count: number | null): DeckRules {
  const overrides = (deck.overrides ?? []).filter(card => card.rank !== rank || card.suit !== suit);
  if (count !== null) overrides.push({ rank, suit, count });
  return { ...deck, overrides };
}

export function DeckCards({ deck, suits, onChange }: {
  readonly deck: DeckRules; readonly suits: readonly Suit[]; readonly onChange: (deck: DeckRules) => void;
}) {
  const [selected, setSelected] = useState<{ rank: Rank; suit: Suit } | null>(null);
  const active = selected && deck.ranks.includes(selected.rank) ? selected : null;
  return <>
    <details className="deck-card-editor">
      <summary>カードごとの枚数</summary>
      <div className="deck-kind-scroll"><div className="deck-kind-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, deck.ranks.length)}, minmax(44px, 1fr))` }}>
        {suits.flatMap(suit => deck.ranks.map(rank => {
          const count = cardCount(deck, rank, suit);
          const custom = deck.overrides?.some(card => card.rank === rank && card.suit === suit);
          return <button key={`${rank}/${suit}`} type="button" className="deck-kind" data-custom={!!custom} data-red={suit === 'hearts' || suit === 'diamonds'}
            aria-label={`${cardLabel({ rank, suit })} ${count}枚`} aria-pressed={active?.rank === rank && active.suit === suit}
            onClick={() => setSelected({ rank, suit })}><span>{cardLabel({ rank, suit })}</span><small>×{count}</small></button>;
        }))}
      </div></div>
      {active && <div className="deck-card-count" key={`${active.rank}/${active.suit}`}>
        <EditableNumber label={`${cardLabel(active)} の枚数`} value={cardCount(deck, active.rank, active.suit)} min={0} max={99}
          onChange={count => onChange(setCardCount(deck, active.rank, active.suit, count))} />
        <button type="button" className="btn btn-ghost" disabled={!deck.overrides?.some(card => card.rank === active.rank && card.suit === active.suit)}
          onClick={() => onChange(setCardCount(deck, active.rank, active.suit, null))}>共通の枚数に戻す</button>
      </div>}
      <p className="hint">カードを選んで枚数を編集。0枚で除外します。個別指定は共通の枚数より優先されます。</p>
    </details>
    <DeckContents deck={deck} />
  </>;
}
