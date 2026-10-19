import type { Card, Suit } from '@wildcard/engine';

const SUIT_GLYPH: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const RED_SUITS: ReadonlySet<Suit> = new Set<Suit>(['hearts', 'diamonds']);

/** 札の呼び名。読み上げにも、文章の中に混ぜるときにも使う。 */
export const cardLabel = (card: Card): string =>
  card.joker !== undefined ? 'JOKER' : `${card.rank}${SUIT_GLYPH[card.suit]}`;

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
  else if (card.joker === undefined && RED_SUITS.has(card.suit)) classes.push('card-red');
  if (highlighted) classes.push('card-highlighted');

  if (!card) {
    return <div className={classes.join(' ')} aria-label="裏向きのカード" />;
  }

  // ジョーカーは rank と suit に意味がない（評価の前に別の札へ置き換わる）。
  // そのまま描くと実在の札に見えてしまうので、専用の見た目にする。
  if (card.joker !== undefined) {
    return (
      <div className={[...classes, 'card-joker'].join(' ')} aria-label={cardLabel(card)}>
        <span className="card-rank">★</span>
        <span className="card-joker-label">JOKER</span>
      </div>
    );
  }

  return (
    <div className={classes.join(' ')} aria-label={cardLabel(card)}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
    </div>
  );
}

/** 空のスロット。まだ配られていないコミュニティカードの位置を示す。 */
export function CardSlot({ size = 'md' }: { readonly size?: CardSize }) {
  return <div className={`card card-${size} card-slot`} />;
}
