import { useEffect, useRef, type CSSProperties } from 'react';
import type { VisibleState } from '@wildcard/engine';
import type { TableRuntimeSnapshot } from '../transport/tableRuntime.js';
import { useCardAppearance } from '../cardAppearance.js';
import { CharacterMark } from './Brand.js';

/** Decorative only: never contains card faces or determines game state. */
export function TableStock({ burnedCount }: { readonly burnedCount: number }) {
  const { appearance } = useCardAppearance();
  return <div className="table-stock" aria-label={`山札とバーン済み${burnedCount}枚`}>
    <span className="stock-deck motion-card" data-back={appearance.back} aria-hidden="true">
      <span className="motion-card-mark">{appearance.back === 'dragon' ? <CharacterMark /> : appearance.back === 'diamond' ? '◆' : 'W'}</span>
    </span>
    <span className={`stock-burn${burnedCount ? ' stock-burn-used' : ''}`} aria-hidden="true" />
  </div>;
}

export function PotChips({ amount }: { readonly amount: number }) {
  // Denominations convey scale; the adjacent numeric total is always authoritative.
  const stacks = [1000, 100, 10, 1].map(value => ({ value, count: Math.floor(amount / value) % (value === 1000 ? Infinity : 10) }))
    .filter(stack => stack.count > 0);
  return <span className="pot-chips" aria-hidden="true">
    {stacks.map(({ value, count }) => <span key={value} className="chip-stack" data-value={value}>
      {Array.from({ length: Math.min(count, 5) }, (_, index) => <i key={index} style={{ '--level': index } as CSSProperties} />)}
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
    const fly = (from: ReturnType<typeof center>, to: ReturnType<typeof center>, kind: string, at: number, delay = 0) => {
      const duration = kind === 'win' ? 650 : 340;
      const elapsed = Date.now() - at - delay;
      if (!from || !to || reduced || elapsed >= duration) return;
      const piece = document.createElement('span');
      piece.className = `motion-piece ${kind === 'bet' || kind === 'win' ? 'motion-chips' : 'motion-card'}`;
      piece.dataset.kind = kind;
      piece.dataset.back = appearance.back;
      if (kind !== 'bet' && kind !== 'win') {
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
      if (Date.now() - event.at > 2200) continue;
      if (event.kind === 'deal') {
        // Start left of the dealer; deal one round at a time, including Omaha.
        const players = state.players.filter(player => player.inHand).sort((a, b) =>
          ((a.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount) - ((b.seat - state.dealerSeat - 1 + state.seatCount) % state.seatCount));
        players.forEach((player, order) => player.holeCards.forEach((_, index) => {
          const seat = seatOf(player.id);
          fly(deck, center(seat?.querySelector('.seat-cards') ?? seat), 'deal', event.at, (index * state.seatCount + order) * 22);
        }));
      } else if (event.kind === 'burn') {
        for (let i = 0; i < Math.min(event.count, 6); i++) fly(deck, burn, 'burn', event.at, i * 100);
      } else if (event.kind === 'fold') {
        fly(center(seatOf(event.playerId)), burn, 'fold', event.at);
      } else if (event.kind === 'bet' || event.kind === 'win') {
        const seat = center(seatOf(event.playerId));
        fly(event.kind === 'win' ? pot : seat, event.kind === 'win' ? seat : pot, event.kind, event.at,
          event.kind === 'win' ? (runtime.events.some(e => e.kind === 'board' && e.at === event.at) ? 1100 : 300) : 0);
      }
    }
    // IDs are monotonic, but do not retain every event over a long session.
    const oldest = runtime.events[0]?.id ?? 0;
    for (const id of seen.current) if (id < oldest) seen.current.delete(id);
  }, [runtime, state, appearance.back]);
  return <div ref={layer} className="table-motion" aria-hidden="true" />;
}
