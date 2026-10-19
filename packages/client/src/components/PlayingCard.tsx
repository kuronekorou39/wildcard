import type { Card, Suit } from '@wildcard/engine';

const SUIT_GLYPH: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const RED_SUITS: ReadonlySet<Suit> = new Set<Suit>(['hearts', 'diamonds']);

export type CardSize = 'sm' | 'md' | 'lg';

interface PlayingCardProps {
  /** null なら裏向き。伏せられているカードはそもそも値が来ない。 */
  readonly card: Card | null;
  readonly size?: CardSize;
  /** 役に使われたカードを強調する。 */
  readonly highlighted?: boolean;
}

export function PlayingCard({ card, size = 'md', highlighted = false }: PlayingCardProps) {
  const classes = ['card', `card-${size}`];
  if (!card) classes.push('card-back');
  else if (RED_SUITS.has(card.suit)) classes.push('card-red');
  if (highlighted) classes.push('card-highlighted');

  if (!card) {
    return <div className={classes.join(' ')} aria-label="裏向きのカード" />;
  }

  return (
    <div className={classes.join(' ')} aria-label={`${card.rank}${SUIT_GLYPH[card.suit]}`}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

/** 空のスロット。まだ配られていないコミュニティカードの位置を示す。 */
export function CardSlot({ size = 'md' }: { readonly size?: CardSize }) {
  return <div className={`card card-${size} card-slot`} />;
}
