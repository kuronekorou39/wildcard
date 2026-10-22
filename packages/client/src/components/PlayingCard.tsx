import type { Card, Suit } from '@wildcard/engine';
import { useCardAppearance, type BackStyle, type FaceStyle } from '../cardAppearance.js';
import { CharacterMark } from './Brand.js';
import { useMemo, type CSSProperties } from 'react';
import { TABLE_TIMING as T } from '../transport/presentation.js';

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
  readonly dimmed?: boolean;
  readonly faceStyle?: FaceStyle;
  readonly backStyle?: BackStyle;
  readonly revealAt?: number | null;
  readonly revealDelay?: number;
  readonly revealKind?: 'deal' | 'board';
}

export function PlayingCard({ card, size = 'md', highlighted = false, dimmed = false, faceStyle, backStyle, revealAt, revealDelay = 0, revealKind = 'deal' }: PlayingCardProps) {
  const { appearance } = useCardAppearance();
  const motion = useMemo<CSSProperties | undefined>(() => {
    if (revealAt == null || Date.now() - revealAt > revealDelay + T.card) return undefined;
    return { animationName: revealKind === 'board' ? 'board-reveal' : 'hand-reveal',
      animationDelay: `${revealAt + revealDelay - Date.now()}ms`, animationDuration: `${T.card}ms` };
  }, [revealAt, revealDelay, revealKind]);
  const face = faceStyle ?? appearance.face;
  const back = backStyle ?? appearance.back;
  const classes = ['card', `card-${size}`];
  if (motion) classes.push('card-revealing');
  if (!card) classes.push('card-back', `card-back-${back}`);
  else {
    classes.push(`card-face-${face}`);
    if (card.joker === undefined) {
      classes.push(`card-suit-${card.suit}`);
      if (RED_SUITS.has(card.suit)) classes.push('card-red');
    }
  }
  if (highlighted) classes.push('card-highlighted');
  if (dimmed) classes.push('card-unused');

  if (!card) {
    return (
      <div className={classes.join(' ')} style={motion} aria-label="裏向きのカード">
        <span className="card-back-emblem" aria-hidden="true">
          {back === 'dragon' ? <CharacterMark /> : back === 'diamond' ? '◆' : 'W'}
        </span>
      </div>
    );
  }

  // ジョーカーは rank と suit に意味がない（評価の前に別の札へ置き換わる）。
  // そのまま描くと実在の札に見えてしまうので、専用の見た目にする。
  if (card.joker !== undefined) {
    return (
      <div className={[...classes, 'card-joker'].join(' ')} style={motion} aria-label={cardLabel(card)}>
        <span className="card-rank">★</span>
        <span className="card-joker-label">JOKER</span>
      </div>
    );
  }

  return (
    <div className={classes.join(' ')} style={motion} aria-label={cardLabel(card)}>
      <span className="card-index" aria-hidden="true">
        <span className="card-rank">{card.rank}</span>
        <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
      </span>
      {face === 'classic' && (
        <>
          <span className="card-center-suit" aria-hidden="true">{SUIT_GLYPH[card.suit]}</span>
          <span className="card-index card-index-bottom" aria-hidden="true">
            <span className="card-rank">{card.rank}</span>
            <span className="card-suit">{SUIT_GLYPH[card.suit]}</span>
          </span>
        </>
      )}
    </div>
  );
}

/** 空のスロット。まだ配られていないコミュニティカードの位置を示す。 */
export function CardSlot({ size = 'md' }: { readonly size?: CardSize }) {
  return <div className={`card card-${size} card-slot`} />;
}
