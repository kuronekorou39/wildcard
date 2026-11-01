import { useState } from 'react';
import { EditableNumber } from '../EditableValue.js';
import { DeckContents } from '../DeckContents.js';
import { Icon } from '../Icon.js';
import { type DeckRules, type Rank, type Suit } from '@wildcard/engine';

const SUIT_LABEL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};
const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';

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
          {deck.suitRanking !== undefined && <button type="button" className="order-toggle" aria-pressed={orderingSuits} onClick={() => setOrderingSuits(!orderingSuits)}>{orderingSuits ? '並べ替えを完了' : '並べ替え'}</button>}
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
            <small className="checkline-note">同じランクで並んだときの決着に使います。付けないと引き分け（チョップ）。</small>
          </span>
        </label>
      </div>

      <div className="field">
        <div className="field-head">
          <span className="field-label">ランク（左が強い）</span>
          <button type="button" className="order-toggle" aria-pressed={orderingRanks} onClick={() => setOrderingRanks(!orderingRanks)}>{orderingRanks ? '並べ替えを完了' : '並べ替え'}</button>
        </div>
        <OrderRow
          items={display.map((rank) => ({ key: rank, label: rank, on: deck.ranks.includes(rank), name: rank }))}
          ordering={orderingRanks}
          onToggle={(key) => toggleRank(key as Rank)}
          onMove={(key, by) => moveRank(key as Rank, by)}
        />
        <p className="hint">押すと使う・使わないを切り替えます。並びが決めるのは強さだけで、ストレートの連続は 2…A の本来の順で判定します。</p>
      </div>

      <div className="field-row">
        <EditableNumber label="各カードの枚数" value={deck.copies ?? 1} min={0} max={99} onChange={copies => onChange({ ...deck, copies })} />
        <EditableNumber label="ジョーカー" value={deck.jokers ?? 0} min={0} max={99} onChange={jokers => onChange({ ...deck, jokers })} />
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
 * 並べ替え中は、使っている札の両脇に ‹ ›（強くする／弱くする）が出る。
 */
function OrderRow({ items, ordering, onToggle, onMove }: {
  readonly items: readonly OrderItem[]; readonly ordering: boolean;
  readonly onToggle: (key: string) => void; readonly onMove: (key: string, by: -1 | 1) => void;
}) {
  const active = items.filter((item) => item.on);
  return <div className="chips order-row">
    {items.map((item) => {
      const at = active.indexOf(item);
      const chip = <button type="button" className={`chip ${item.on ? 'chip-on' : 'chip-off'} ${item.red ? 'chip-red' : ''}`} aria-pressed={item.on}
        aria-label={`${item.name}${item.on ? '' : '（使わない）'}`} onClick={() => onToggle(item.key)}>{item.label}</button>;
      if (!ordering || !item.on) return <span key={item.key} className="order-item">{chip}</span>;
      return <span key={item.key} className="order-item order-item-active">
        <button type="button" className="rank-order-arrow" aria-label={`${item.name} を強くする`} disabled={at === 0} onClick={() => onMove(item.key, -1)}>‹</button>
        {chip}
        <button type="button" className="rank-order-arrow" aria-label={`${item.name} を弱くする`} disabled={at === active.length - 1} onClick={() => onMove(item.key, 1)}><Icon kind="chevron-right" /></button>
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
