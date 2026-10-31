import { useState } from 'react';
import { Icon } from '../Icon.js';
import {
  describePattern,
  exampleHand,
  fromBlocks,
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
 */
export function RankingEditor({ variant, onChange }: RankingEditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const hands = variant.ranking.hands;

  const replace = (next: readonly HandRanking[]) => onChange({ ...variant.ranking, hands: next });

  const move = (at: number, by: number) => {
    const to = at + by;
    if (to < 0 || to >= hands.length) return;
    const next = [...hands];
    const moved = next[at]!;
    next[at] = next[to]!;
    next[to] = moved;
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

  return (
    <section className="panel">
      <h2 className="panel-title">役（上が強い）</h2>

      <ol className="ranking-list">
        {hands.map((hand, i) => (
          <li key={hand.id} className={`ranking-item ${hand.enabled ? '' : 'ranking-item-off'}`}>
            <div className="ranking-row">
              <div className="ranking-move">
                <button
                  type="button"
                  aria-label={`${hand.name} を強くする`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`${hand.name} を弱くする`}
                  disabled={i === hands.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </div>

              <div className="ranking-body">
                <span className="ranking-name">{hand.name}</span>
                <span className="ranking-pattern">{describePattern(hand.pattern)}</span>
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

                <Example variant={variant} rankingId={hand.id} />

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
 * いま編集している役の例。
 *
 * 条件をいじるたびに「で、それは何の手になるのか」が出る。これが無いと、
 * 作ったつもりの役が実は成立しないことに気づけない。
 */
function Example({ variant, rankingId }: { readonly variant: Variant; readonly rankingId: string }) {
  let hand: ReturnType<typeof exampleHand> = null;
  try {
    hand = exampleHand(variant, rankingId, { seed: 3 });
  } catch {
    // 編集の途中はデッキが壊れていることがある（例: ランクを全部外した）。
    // 例が出ないだけで、編集は続けられるべき。
    hand = null;
  }

  return (
    <div className="field">
      <span className="field-label">成立する手の例</span>
      {hand ? (
        <div className="rule-row-cards">
          {hand.map((card, i) => (
            <PlayingCard key={i} card={card} size="sm" />
          ))}
        </div>
      ) : (
        <p className="hint hint-warn">
          この条件で成立する手が見つかりません。上の役と重なっているか、デッキに
          足りない札があります。
        </p>
      )}
    </div>
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
