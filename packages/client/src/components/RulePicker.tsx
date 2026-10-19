import { useMemo, useState } from 'react';
import {
  activeRankings,
  boardSize,
  buildDeck,
  describePattern,
  describeWilds,
  evaluateExact,
  exampleHands,
  wildResolutions,
} from '@wildcard/engine';
import type { Card, Variant } from '@wildcard/engine';
import { PlayingCard, cardLabel } from './PlayingCard.js';
import { isCustomVariant, useVariants } from '../rules/customVariants.js';

interface RulePickerProps {
  readonly value: string;
  readonly onChange: (variantId: string) => void;
  /** 編集画面を開く。渡さなければボタンを出さない。 */
  readonly onEdit?: (variantId: string) => void;
}

/**
 * ルールの選択。
 *
 * 並んでいるものはすべて Variant というデータで、エンジンのコードは
 * どれを選んでも同じ。Wildcard の中心にある考え方が最初に目に入る場所なので、
 * 何が変わるのかをその場で読めるようにしてある。
 */
export function RulePicker({ value, onChange, onEdit }: RulePickerProps) {
  const variants = useVariants();
  const selected = variants.find((v) => v.id === value) ?? variants[0]!;
  const custom = variants.filter((v) => isCustomVariant(v.id));
  const presets = variants.filter((v) => !isCustomVariant(v.id));

  return (
    <div className="field">
      <span className="field-label">ルール</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
        {custom.length > 0 && (
          <optgroup label="自分で作ったルール">
            {custom.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {selected.description !== undefined && (
        <p className="hint rule-description">{selected.description}</p>
      )}
      <RuleSheet variant={selected} label="役の順位を見る" />
      {onEdit !== undefined && (
        <div className="rule-actions">
          <button type="button" className="btn btn-ghost" onClick={() => onEdit(selected.id)}>
            {isCustomVariant(selected.id) ? 'このルールを編集' : 'これを元に作る'}
          </button>
        </div>
      )}
    </div>
  );
}

interface RuleSheetProps {
  /**
   * 見せるルールそのもの。id ではなく実体を受け取る。
   *
   * オンラインではガイドの端末にプリセットが無いこともある
   * （ホストが作ったカスタムルール）。卓の state には Variant が
   * まるごと入って届くので、それをそのまま渡せばよい。
   */
  readonly variant: Variant | null;
  readonly label?: string;
}

/**
 * 有効な役を強い順に並べて見せる。変則ルールでは手元に欲しくなる。
 *
 * **役名だけでは足りない。** 「素数ストレート」「ペア＋三連」のような
 * 独自役は、名前を見ても何が成立するのか分からない。条件の説明と、
 * 実際に成立する札を一緒に出す（→ engine の example.ts）。
 */
export function RuleSheet({ variant, label = 'ルール' }: RuleSheetProps) {
  // 例は役ごとに試行を回して作る。卓の画面にも出るので、
  // 開くまでは計算しない。閉じたままなら一度も走らない。
  const [opened, setOpened] = useState(false);
  const examples = useMemo(
    () =>
      variant && opened ? exampleHands(variant, { seed: 11 }) : new Map<string, Card[] | null>(),
    [variant, opened],
  );

  if (!variant) return null;

  const rankings = activeRankings(variant);
  const deck = variant.deck;
  const wilds = describeWilds(variant);

  return (
    <details className="rule-sheet" onToggle={(e) => setOpened(e.currentTarget.open)}>
      <summary className="rule-sheet-summary">{label}</summary>
      <div className="rule-sheet-body">
        <p className="rule-sheet-deck">
          デッキ {buildDeck(deck).length}枚（{deck.ranks.join(' ')}）
          {deck.suitRanking !== undefined && ' ／ スートに強弱あり'}
          <br />
          手札{variant.structure.holeCards}枚 ／ 場{boardSize(variant.structure)}枚
          {variant.structure.holeUsage !== undefined &&
            ` ／ 手札からちょうど${variant.structure.holeUsage.min}枚使う`}
          {wilds !== null && (
            <>
              {/* 「デッキ53枚」だけでは、その1枚が何なのか分からない。 */}
              <br />
              <span className="rule-sheet-wilds">{wilds}</span>
            </>
          )}
        </p>
        <ol className="rule-sheet-list">
          {rankings.map((ranking) => (
            <li key={ranking.id} className="rule-row">
              <div className="rule-row-head">
                <span className="rule-row-name">{ranking.name}</span>
                <span className="rule-row-pattern">{describePattern(ranking.pattern)}</span>
              </div>
              <RuleExample variant={variant} hand={examples.get(ranking.id) ?? null} />
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

interface RuleExampleProps {
  readonly variant: Variant;
  readonly hand: readonly Card[] | null;
}

/** その役が成立する札の一例。 */
function RuleExample({ variant, hand }: RuleExampleProps) {
  if (!hand) {
    // 条件が厳しすぎて例が作れないことはある。黙って消すより、そう言う。
    return <p className="rule-row-example-none">このデッキでは成立しない</p>;
  }

  // ワイルドが混ざった手は札を見ただけでは読めない。
  // 「J J J 2 2 がファイブカード」は、2 が J になったことが見えて初めて分かる。
  const result = evaluateExact(hand, variant);
  const wilds = result ? wildResolutions(result, variant) : [];

  return (
    <div className="rule-row-example">
      <div className="rule-row-cards">
        {hand.map((card, i) => (
          <PlayingCard key={i} card={card} size="sm" />
        ))}
      </div>
      {wilds.length > 0 && (
        <span className="rule-row-wilds">
          {wilds
            // スートに意味が無い役では、スートまで書くと嘘に見える
            // （手の中に本物の 8♠ が居るのに「JOKER→8♠」と出てしまう）。
            .map((w) => `${cardLabel(w.card)}→${w.suitMatters ? cardLabel(w.becomes) : w.becomes.rank}`)
            .join('、')}
        </span>
      )}
    </div>
  );
}
