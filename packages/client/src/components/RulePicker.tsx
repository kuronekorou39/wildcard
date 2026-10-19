import { RULE_PRESETS, activeRankings, findPreset } from '@wildcard/engine';

interface RulePickerProps {
  readonly value: string;
  readonly onChange: (ruleSetId: string) => void;
}

/**
 * ルールの選択。
 *
 * 並んでいるものはすべて RuleSet というデータで、エンジンのコードは
 * どれを選んでも同じ。Wildcard の中心にある考え方が最初に目に入る場所なので、
 * 何が変わるのかをその場で読めるようにしてある。
 */
export function RulePicker({ value, onChange }: RulePickerProps) {
  const selected = findPreset(value) ?? RULE_PRESETS[0]!;

  return (
    <div className="field">
      <span className="field-label">ルール</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {RULE_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      {selected.description !== undefined && (
        <p className="hint rule-description">{selected.description}</p>
      )}
      <RuleSheet ruleSetId={selected.id} label="役の順位を見る" />
    </div>
  );
}

interface RuleSheetProps {
  readonly ruleSetId: string;
  readonly label?: string;
}

/** 有効な役を強い順に並べて見せる。変則ルールでは手元に欲しくなる。 */
export function RuleSheet({ ruleSetId, label = 'ルール' }: RuleSheetProps) {
  const ruleSet = findPreset(ruleSetId);
  if (!ruleSet) return null;

  const rankings = activeRankings(ruleSet);
  const deck = ruleSet.deck;

  return (
    <details className="rule-sheet">
      <summary className="rule-sheet-summary">{label}</summary>
      <div className="rule-sheet-body">
        <p className="rule-sheet-deck">
          デッキ {deck.suits.length * deck.ranks.length}枚（{deck.ranks.join(' ')}）
          {deck.suitRanking !== undefined && ' ／ スートに強弱あり'}
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
