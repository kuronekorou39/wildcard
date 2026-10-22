import { useEffect, useRef, type CSSProperties } from 'react';
import type { VisibleState } from '@wildcard/engine';
import type { TableRuntimeSnapshot } from '../transport/tableRuntime.js';
import { useCardAppearance } from '../cardAppearance.js';
import { CharacterMark } from './Brand.js';
import { contributedChips, TABLE_TIMING as T, type ChipStack } from '../transport/presentation.js';

/** Decorative only: never contains card faces or determines game state. */
export function TableStock({ burnedCount }: { readonly burnedCount: number }) {
  const { appearance } = useCardAppearance();
  return <div className="table-stock" aria-label={`山札とバーン済み${burnedCount}枚`}>
    <span className="stock-pile"><span className="stock-deck motion-card" data-back={appearance.back} aria-hidden="true">
      <span className="motion-card-mark">{appearance.back === 'dragon' ? <CharacterMark /> : appearance.back === 'diamond' ? '◆' : 'W'}</span>
    </span></span>
    <span className="stock-pile"><span className={`stock-burn${burnedCount ? ' stock-burn-used' : ''}`} data-back={appearance.back} aria-hidden="true">
      {burnedCount > 0 && <><span className="motion-card-mark">{appearance.back === 'dragon' ? <CharacterMark /> : appearance.back === 'diamond' ? '◆' : 'W'}</span><b className="stock-count">{burnedCount}</b></>}
    </span></span>
  </div>;
}

export function PotChips({ stacks, className = 'pot-chips' }: { readonly stacks: readonly ChipStack[]; readonly className?: string }) {
  return <span className={className} aria-hidden="true">
    {stacks.map(({ value, count }) => <span key={value} className="chip-stack" data-value={value} data-count={count}>
      {Array.from({ length: Math.min(count, 10) }, (_, index) => <i key={index} style={{ '--level': index } as CSSProperties} />)}
    </span>)}
  </span>;
}

export function TableMotion({ state, runtime }: { readonly state: VisibleState; readonly runtime: TableRuntimeSnapshot | null }) {
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<number>());
  const animations = useRef(new Set<Animation>());
  const { appearance } = useCardAppearance();
  useEffect(() => () => {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
    seen.current.clear();
  }, []);
  useEffect(() => {
    const root = layer.current;
    const table = root?.parentElement;
    if (!root || !table || !runtime) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bounds = root.getBoundingClientRect();
    const center = (node: Element | null) => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.x + box.width / 2 - bounds.x, y: box.y + box.height / 2 - bounds.y } : null;
    };
    const deck = center(table.querySelector('.stock-deck'));
    const burn = center(table.querySelector('.stock-burn'));
    const pot = center(table.querySelector('.table-pot'));
    const seatOf = (id: string) => [...table.querySelectorAll<HTMLElement>('.seat')].find(seat => seat.dataset.playerId === id) ?? null;
    const betOf = (id: string) => [...table.querySelectorAll<HTMLElement>('.table-bet-anchor')].find(bet => bet.dataset.playerId === id)?.querySelector('.table-bet') ?? null;
    const fly = (from: ReturnType<typeof center>, to: ReturnType<typeof center>, kind: string, at: number, delay = 0, value = 10) => {
      const duration = kind === 'win' ? T.win : kind === 'bet' ? T.bet : kind === 'collect' ? T.collect : T.card;
      const elapsed = Date.now() - at - delay;
      if (!from || !to || reduced || elapsed >= duration) return;
      const piece = document.createElement('span');
      const chip = kind === 'bet' || kind === 'win' || kind === 'collect';
      piece.className = `motion-piece ${chip ? 'motion-chips' : 'motion-card'}`;
      piece.dataset.kind = kind;
      piece.dataset.value = String(value);
      piece.dataset.back = appearance.back;
      if (!chip) {
        const emblem = table.querySelector('.stock-deck .motion-card-mark');
        if (emblem) piece.append(emblem.cloneNode(true));
      }
      root.append(piece);
      const transform = (point: { x: number; y: number }, rotate: number) => `translate(${point.x}px, ${point.y}px) translate(-50%, -50%) rotate(${rotate}deg)`;
      const animation = piece.animate([
        { transform: transform(from, -12), opacity: 0 },
        { transform: transform(from, -12), opacity: .95, offset: .12 },
        { transform: transform(to, 8), opacity: .95, offset: .85 },
        { transform: transform(to, 8), opacity: 0 },
      ], { duration, delay: Math.max(0, -elapsed), easing: 'cubic-bezier(.2,.65,.3,1)', fill: 'both' });
      if (elapsed > 0) animation.currentTime = elapsed;
      animations.current.add(animation);
      const clean = () => { animations.current.delete(animation); piece.remove(); };
      animation.onfinish = clean;
      animation.oncancel = clean;
    };
    for (const event of runtime.events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      if (Date.now() - event.at > T.history) continue;
      if (event.kind === 'deal') {
        // Start left of the dealer; deal one round at a time, including Omaha.
        const players = state.players.filter(player => player.inHand).sort((a, b) =>
          ((a.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount) - ((b.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount));
        players.forEach((player, order) => player.holeCards.forEach((_, index) => {
          const seat = seatOf(player.id);
          fly(deck, center(seat?.querySelector('.seat-cards') ?? seat), 'deal', event.at, (index * state.seatCount + order) * T.dealGap);
        }));
      } else if (event.kind === 'burn') {
        for (let i = 0; i < Math.min(event.count, 6); i++) fly(deck, burn, 'burn', event.at, i * T.dealGap);
      } else if (event.kind === 'fold') {
        fly(center(seatOf(event.playerId)), burn, 'fold', event.at);
      } else if (event.kind === 'bet' || event.kind === 'win') {
        const seat = center(seatOf(event.playerId));
        const chips = event.kind === 'bet' ? contributedChips(event.amount) : runtime.potChips;
        chips.forEach(chip => fly(event.kind === 'win' ? pot : seat, event.kind === 'win' ? seat : center(betOf(event.playerId)),
          event.kind, event.at, 0, chip.value));
      } else if (event.kind === 'collect') {
        for (const bet of event.bets) for (const chip of bet.chips)
          fly(center(betOf(bet.playerId)), pot, 'collect', event.at, 0, chip.value);
      }
    }
    // IDs are monotonic, but do not retain every event over a long session.
    const oldest = runtime.events[0]?.id ?? 0;
    for (const id of seen.current) if (id < oldest) seen.current.delete(id);
  }, [runtime, state, appearance.back]);
  return <div ref={layer} className="table-motion" aria-hidden="true" />;
}
