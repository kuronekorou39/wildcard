import { VARIANT_PRESETS, activeRankings, buildDeck, findVariant, boardSize } from '@wildcard/engine';

interface RulePickerProps {
  readonly value: string;
  readonly onChange: (variantId: string) => void;
}

/**
 * ルールの選択。
 *
 * 並んでいるものはすべて Variant というデータで、エンジンのコードは
 * どれを選んでも同じ。Wildcard の中心にある考え方が最初に目に入る場所なので、
 * 何が変わるのかをその場で読めるようにしてある。
 */
export function RulePicker({ value, onChange }: RulePickerProps) {
  const selected = findVariant(value) ?? VARIANT_PRESETS[0]!;

  return (
    <div className="field">
      <span className="field-label">ルール</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {VARIANT_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      {selected.description !== undefined && (
        <p className="hint rule-description">{selected.description}</p>
      )}
      <RuleSheet variantId={selected.id} label="役の順位を見る" />
    </div>
  );
}

interface RuleSheetProps {
  readonly variantId: string;
  readonly label?: string;
}

/** 有効な役を強い順に並べて見せる。変則ルールでは手元に欲しくなる。 */
export function RuleSheet({ variantId, label = 'ルール' }: RuleSheetProps) {
  const variant = findVariant(variantId);
  if (!variant) return null;

  const rankings = activeRankings(variant);
  const deck = variant.deck;

  return (
    <details className="rule-sheet">
      <summary className="rule-sheet-summary">{label}</summary>
      <div className="rule-sheet-body">
        <p className="rule-sheet-deck">
          デッキ {buildDeck(deck).length}枚（{deck.ranks.join(' ')}）
          {deck.suitRanking !== undefined && ' ／ スートに強弱あり'}
          <br />
          手札{variant.structure.holeCards}枚 ／ 場{boardSize(variant.structure)}枚
          {variant.structure.holeUsage !== undefined &&
            ` ／ 手札からちょうど${variant.structure.holeUsage.min}枚使う`}
        </p>
        <ol className="rule-sheet-list">
          {rankings.map((ranking) => (
            <li key={ranking.id}>{ranking.name}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
