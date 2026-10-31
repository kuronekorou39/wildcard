import { useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.js';
import {
  describePattern,
  exampleHands,
  fromBlocks,
  type Card,
  type HandRanking,
  type RankingRules,
  type Variant,
} from '@wildcard/engine';
import { PlayingCard } from '../PlayingCard.js';
import { PatternEditor } from './PatternEditor.js';

interface RankingEditorProps {
  readonly variant: Variant;
  readonly onChange: (ranking: RankingRules) => void;
}

/**
 * 役の編集。
 *
 * 並び順がそのまま強さ（上が強い）。**強さは「どれが上か」でしかない**ので、
 * 得点のような数値は持たせていない。フラッシュをフルハウスより上に動かせば
 * ショートデッキになる。
 *
 * 並べ替えは、つまみを引きずる（マウス・指）か、つまみにフォーカスして
 * ↑↓・Home・End。1段ずつのボタンも残してある。
 */
export function RankingEditor({ variant, onChange }: RankingEditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ readonly from: number; readonly to: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const hands = variant.ranking.hands;
  // 例は役ごとに試行を回して作る。編集のたびに全部作り直すが、条件を変えたときに
  // 「で、どの手になるのか」がその場で見えないと、成立しない役に気づけない。
  const examples = useMemo(() => {
    try { return exampleHands(variant, { seed: 3 }); }
    catch { return new Map<string, Card[] | null>(); } // 編集の途中はデッキが壊れていることがある（例: ランクを全部外した）
  }, [variant]);

  const replace = (next: readonly HandRanking[]) => onChange({ ...variant.ranking, hands: next });

  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= hands.length) return;
    const next = [...hands];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    replace(next);
  };

  const update = (id: string, patch: Partial<HandRanking>) =>
    replace(hands.map((hand) => (hand.id === id ? { ...hand, ...patch } : hand)));

  const add = () => {
    const id = freeId(hands);
    replace([
      ...hands,
      {
        id,
        name: '新しい役',
        enabled: true,
        // 「同じランクが2枚」から始める。いちばん短く、意味の分かる形。
        pattern: fromBlocks([{ kind: 'sameRank', count: 2 }]),
      },
    ]);
    setEditing(id);
  };

  /** 指の位置から、落とす先の番号を決める。各行の中心より上なら、その行の前。 */
  const indexAt = (y: number): number => {
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>('.ranking-item') ?? []);
    const at = rows.findIndex(row => { const r = row.getBoundingClientRect(); return y < r.top + r.height / 2; });
    return at < 0 ? rows.length - 1 : at;
  };

  return (
    <section className="panel" aria-label="役の強さ">
      <p className="hint ranking-note">上が強い。つまみを引きずるか、↑↓で並べ替え。</p>

      <ol ref={list} className="ranking-list">
        {hands.map((hand, i) => (
          <li key={hand.id} className={`ranking-item ${hand.enabled ? '' : 'ranking-item-off'} ${drag?.from === i ? 'ranking-item-dragging' : ''} ${drag && drag.to === i && drag.from !== i ? (drag.to < drag.from ? 'ranking-item-over-before' : 'ranking-item-over-after') : ''}`}>
            <div className="ranking-row">
              <button
                type="button"
                className="ranking-handle"
                aria-label={`${hand.name} の順位を動かす（${i + 1}位）。↑↓で1つ、Home・Endで端へ`}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDrag({ from: i, to: i }); }}
                onPointerMove={(event) => { if (drag) setDrag({ from: drag.from, to: indexAt(event.clientY) }); }}
                onPointerUp={() => { if (drag) moveTo(drag.from, drag.to); setDrag(null); }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(event) => {
                  const to = event.key === 'ArrowUp' ? i - 1 : event.key === 'ArrowDown' ? i + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? hands.length - 1 : null;
                  if (to === null) return;
                  event.preventDefault();
                  moveTo(i, to);
                  // 動かした役のつまみにフォーカスを保つ。
                  requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('.ranking-handle')[Math.max(0, Math.min(hands.length - 1, to))]?.focus());
                }}
              >
                <span aria-hidden="true">⋮⋮</span>
              </button>

              <div className="ranking-move">
                <button type="button" aria-label={`${hand.name} を強くする`} disabled={i === 0} onClick={() => moveTo(i, i - 1)}>↑</button>
                <button type="button" aria-label={`${hand.name} を弱くする`} disabled={i === hands.length - 1} onClick={() => moveTo(i, i + 1)}>↓</button>
              </div>

              <div className="ranking-body">
                <span className="ranking-name">{hand.name}</span>
                <span className="ranking-pattern">{describePattern(hand.pattern)}</span>
                {hand.enabled && <Example hand={examples.get(hand.id) ?? null} compact />}
              </div>

              <label className="ranking-enabled">
                <input
                  type="checkbox"
                  checked={hand.enabled}
                  aria-label={`${hand.name} を使う`}
                  onChange={(e) => update(hand.id, { enabled: e.target.checked })}
                />
              </label>

              <button
                type="button"
                className="btn btn-ghost ranking-edit"
                aria-expanded={editing === hand.id}
                onClick={() => setEditing(editing === hand.id ? null : hand.id)}
              >
                {editing === hand.id ? '閉じる' : '編集'}
              </button>
            </div>

            {editing === hand.id && (
              <div className="ranking-editor">
                <label className="field">
                  <span className="field-label">名前</span>
                  <input
                    className="input"
                    value={hand.name}
                    maxLength={24}
                    onChange={(e) => update(hand.id, { name: e.target.value })}
                  />
                </label>

                <PatternEditor
                  pattern={hand.pattern}
                  handSize={variant.structure.handSize}
                  ranks={variant.deck.ranks}
                  onChange={(pattern) => update(hand.id, { pattern })}
                />

                <div className="field">
                  <span className="field-label">成立する手の例</span>
                  <Example hand={hand.enabled ? examples.get(hand.id) ?? null : null} />
                </div>

                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setEditing(null);
                    replace(hands.filter((h) => h.id !== hand.id));
                  }}
                >
                  この役を消す
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <button type="button" className="btn btn-ghost" onClick={add}>
        <Icon kind="plus" />役を足す
      </button>
    </section>
  );
}

/**
 * その役が成立する手の例。条件をいじるたびに「で、それは何の手になるのか」が出る。
 * これが無いと、作ったつもりの役が実は成立しないことに気づけない。
 */
function Example({ hand, compact = false }: { readonly hand: readonly Card[] | null; readonly compact?: boolean }) {
  if (hand) {
    return (
      <div className={`rule-row-cards ${compact ? 'ranking-example' : ''}`}>
        {hand.map((card, i) => (
          <PlayingCard key={i} card={card} size="sm" />
        ))}
      </div>
    );
  }
  if (compact) return <span className="ranking-example ranking-example-none">成立する手が見つかりません</span>;
  return (
    <p className="hint hint-warn">
      この条件で成立する手が見つかりません。上の役と重なっているか、デッキに
      足りない札があります。
    </p>
  );
}

/** 使われていない id を作る。名前を変えても id は変えない（並びと別管理）。 */
function freeId(hands: readonly HandRanking[]): string {
  const used = new Set(hands.map((hand) => hand.id));
  for (let i = 1; ; i++) {
    const id = `custom_${i}`;
    if (!used.has(id)) return id;
  }
}
