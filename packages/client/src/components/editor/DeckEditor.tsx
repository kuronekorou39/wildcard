import { useLayoutEffect, useRef, useState } from 'react';
import { DeckContents } from '../DeckContents.js';
import { Icon } from '../Icon.js';
import { Stepper } from '../Stepper.js';
import { type DeckRules, type Rank, type Suit } from '@wildcard/engine';

const SUIT_LABEL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};
const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';
const sameOrder = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

interface DeckEditorProps {
  readonly deck: DeckRules;
  readonly allRanks: readonly Rank[];
  readonly allSuits: readonly Suit[];
  readonly onChange: (deck: DeckRules) => void;
}

/**
 * デッキの編集。
 *
 * スートもランクも **1つの列** で「使うか」と「強さの順」を決める。画面は強い順（左が強い）。
 * エンジンの `ranks` は弱い順なので、ここで反転して持つ。
 *
 * - ランクの並びがそのまま強さになる。並べ替えると「TT が AA より強い」が作れる。
 *   ストレートの連続は本来の順（2…A）で見るので、並べ替えても変わらない。
 * - 外したランクは、戻したときに入る位置に薄く置いておく。何が抜けているかが一目で分かる。
 * - 並べ替えの矢印の場所は最初から確保してある。モードを切り替えても札の位置は動かない。
 */
export function DeckEditor({ deck, allRanks, allSuits, onChange }: DeckEditorProps) {
  const [orderingSuits, setOrderingSuits] = useState(false);
  const [orderingRanks, setOrderingRanks] = useState(false);

  // ---- スート ----
  const suitOrder: readonly Suit[] = deck.suitRanking ?? allSuits;
  const toggleSuit = (suit: Suit) => {
    const on = deck.suits.includes(suit);
    const next = on ? deck.suits.filter((s) => s !== suit) : allSuits.filter((s) => deck.suits.includes(s) || s === suit);
    onChange({ ...deck, suits: next, overrides: on ? (deck.overrides ?? []).filter(card => card.suit !== suit) : deck.overrides ?? [] });
  };
  const moveSuit = (suit: Suit, by: -1 | 1) => {
    const at = suitOrder.indexOf(suit);
    const to = at + by;
    if (at < 0 || to < 0 || to >= suitOrder.length) return;
    const next = [...suitOrder];
    next[at] = next[to]!;
    next[to] = suit;
    onChange({ ...deck, suitRanking: next });
  };

  // ---- ランク（画面は強い順） ----
  const strongFirst = [...deck.ranks].reverse();
  const display = withExcluded(strongFirst, allRanks);
  const canonical = [...allRanks].reverse().filter((rank) => deck.ranks.includes(rank));
  const toggleRank = (rank: Rank) => {
    const on = deck.ranks.includes(rank);
    // 外すときは個別指定も消す。戻すときは薄く見せていた位置にそのまま入る。
    const nextStrongFirst = on ? strongFirst.filter((r) => r !== rank) : display.filter((r) => deck.ranks.includes(r) || r === rank);
    onChange({ ...deck, ranks: [...nextStrongFirst].reverse(), overrides: on ? (deck.overrides ?? []).filter(card => card.rank !== rank) : deck.overrides ?? [] });
  };
  const moveRank = (rank: Rank, by: -1 | 1) => {
    const at = strongFirst.indexOf(rank);
    const to = at + by;
    if (at < 0 || to < 0 || to >= strongFirst.length) return;
    const next = [...strongFirst];
    next[at] = next[to]!;
    next[to] = rank;
    onChange({ ...deck, ranks: next.reverse() });
  };

  return (
    <section className="panel" aria-label="デッキ">
      <div className="field">
        <div className="field-head">
          <span className="field-label">スート{deck.suitRanking !== undefined && '（左が強い）'}</span>
          {deck.suitRanking !== undefined && <span className="field-tools">
            {!sameOrder(suitOrder, allSuits) && <button type="button" className="order-toggle" onClick={() => onChange({ ...deck, suitRanking: [...allSuits] })}>デフォルトに戻す</button>}
            <button type="button" className="order-toggle" aria-pressed={orderingSuits} onClick={() => setOrderingSuits(!orderingSuits)}>{orderingSuits ? '並べ替えを完了' : '並べ替え'}</button>
          </span>}
        </div>
        <OrderRow
          items={suitOrder.map((suit) => ({ key: suit, label: SUIT_LABEL[suit], on: deck.suits.includes(suit), red: isRed(suit), name: SUIT_LABEL[suit] }))}
          ordering={orderingSuits && deck.suitRanking !== undefined}
          onToggle={(key) => toggleSuit(key as Suit)}
          onMove={(key, by) => moveSuit(key as Suit, by)}
        />
        <label className="checkline">
          <input
            type="checkbox"
            checked={deck.suitRanking !== undefined}
            onChange={(e) => { setOrderingSuits(false); onChange(e.target.checked ? { ...deck, suitRanking: [...allSuits] } : omit(deck, 'suitRanking')); }}
          />
          <span>
            スートに強弱をつける
            <small className="checkline-note">同じランクで並んだときの決着に使います。</small>
          </span>
        </label>
      </div>

      <div className="field">
        <div className="field-head">
          <span className="field-label">ランク（左が強い）</span>
          <span className="field-tools">
            {!sameOrder(strongFirst, canonical) && <button type="button" className="order-toggle" onClick={() => onChange({ ...deck, ranks: [...canonical].reverse() })}>デフォルトに戻す</button>}
            <button type="button" className="order-toggle" aria-pressed={orderingRanks} onClick={() => setOrderingRanks(!orderingRanks)}>{orderingRanks ? '並べ替えを完了' : '並べ替え'}</button>
          </span>
        </div>
        <OrderRow
          items={display.map((rank) => ({ key: rank, label: rank, on: deck.ranks.includes(rank), name: rank }))}
          ordering={orderingRanks}
          onToggle={(key) => toggleRank(key as Rank)}
          onMove={(key, by) => moveRank(key as Rank, by)}
        />
        <p className="hint">並びが決めるのは強さだけで、ストレートの連続は本来の順で判定します。</p>
      </div>

      <div className="field-row">
        <Stepper label="各カードの枚数" value={deck.copies ?? 1} min={0} max={99} onChange={copies => onChange({ ...deck, copies })} />
        <Stepper label="ジョーカー" value={deck.jokers ?? 0} min={0} max={99} onChange={jokers => onChange({ ...deck, jokers })} />
      </div>

      <div className="field">
        <span className="field-label">カードごとの枚数</span>
        <DeckContents deck={deck} onChange={onChange} />
      </div>
    </section>
  );
}

interface OrderItem { readonly key: string; readonly label: string; readonly name: string; readonly on: boolean; readonly red?: boolean }

/**
 * 「使う／使わない」と「強さの順」を1列で。
 *
 * 矢印（強くする／弱くする）の場所は常に確保し、並べ替え中だけ見せる。
 * 入れ替わりは前の位置から滑らせる（FLIP）。
 */
function OrderRow({ items, ordering, onToggle, onMove }: {
  readonly items: readonly OrderItem[]; readonly ordering: boolean;
  readonly onToggle: (key: string) => void; readonly onMove: (key: string, by: -1 | 1) => void;
}) {
  const active = items.filter((item) => item.on);
  const nodes = useRef(new Map<string, HTMLElement>());
  const previous = useRef<{ readonly order: string; readonly at: Map<string, { x: number; y: number }> } | null>(null);
  const order = items.map((item) => item.key).join(',');
  // 動かすのは並び順が変わったときだけ。位置は行の中で測る。
  // 画面上の位置で比べると、スクロールや上の欄の伸び縮みでも「動いた」ことになり、全部が滑ってしまう。
  useLayoutEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const at = new Map<string, { x: number; y: number }>();
    for (const [key, node] of nodes.current) at.set(key, { x: node.offsetLeft, y: node.offsetTop });
    const before = previous.current;
    if (!reduce && before && before.order !== order) {
      for (const [key, node] of nodes.current) {
        const from = before.at.get(key), to = at.get(key)!;
        if (!from || (from.x === to.x && from.y === to.y) || typeof node.animate !== 'function') continue;
        node.animate([{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
      }
    }
    previous.current = { order, at };
  });
  return <div className="chips order-row">
    {items.map((item) => {
      const at = active.indexOf(item);
      const movable = ordering && item.on;
      return <span key={item.key} className={`order-item ${movable ? 'order-item-active' : ''}`} ref={(node) => { if (node) nodes.current.set(item.key, node); else nodes.current.delete(item.key); }}>
        <button type="button" className="rank-order-arrow" tabIndex={movable ? 0 : -1} aria-hidden={!movable} aria-label={`${item.name} を強くする`} disabled={!movable || at === 0} onClick={() => onMove(item.key, -1)}>‹</button>
        <button type="button" className={`chip ${item.on ? 'chip-on' : 'chip-off'} ${item.red ? 'chip-red' : ''}`} aria-pressed={item.on}
          aria-label={`${item.name}${item.on ? '' : '（使わない）'}`} onClick={() => onToggle(item.key)}>{item.label}</button>
        <button type="button" className="rank-order-arrow" tabIndex={movable ? 0 : -1} aria-hidden={!movable} aria-label={`${item.name} を弱くする`} disabled={!movable || at === active.length - 1} onClick={() => onMove(item.key, 1)}><Icon kind="chevron-right" /></button>
      </span>;
    })}
  </div>;
}

/**
 * 使っているランク（強い順）に、外したランクを「戻したときに入る位置」で差し込む。
 * 本来の順で自分より弱い札のうち、いちばん先に並んでいるものの前に置く。無ければ末尾。
 */
function withExcluded(strongFirst: readonly Rank[], allRanks: readonly Rank[]): Rank[] {
  const step = (rank: Rank) => allRanks.indexOf(rank);
  const excluded = [...allRanks].reverse().filter((rank) => !strongFirst.includes(rank));
  const before = new Map<Rank | null, Rank[]>();
  for (const rank of excluded) {
    const anchor = strongFirst.find((r) => step(r) < step(rank)) ?? null;
    before.set(anchor, [...(before.get(anchor) ?? []), rank]);
  }
  return [...strongFirst.flatMap((rank) => [...(before.get(rank) ?? []), rank]), ...(before.get(null) ?? [])];
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _removed, ...rest } = value;
  return rest;
}
