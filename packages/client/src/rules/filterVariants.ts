import { deckSize, type Variant } from '@wildcard/engine';
import { isCustomVariant } from './customVariants.js';
import { categoryLabel, categoryOf } from './ruleCategories.js';

export interface RuleFilters {
  readonly query: string;
  readonly source: 'all' | 'preset' | 'custom';
  readonly holeCards: string;
  readonly limit: string;
  readonly deck: 'all' | 'short' | 'standard' | 'large';
}
export const EMPTY_RULE_FILTERS: RuleFilters = { query: '', source: 'all', holeCards: '', limit: '', deck: 'all' };
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export function filterVariants(variants: readonly Variant[], filters: RuleFilters): readonly Variant[] {
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return variants.filter(variant => {
    // 分類の名前（「ワイルド」など）でも引けるようにする。
    const text = normalize(`${variant.name} ${variant.description ?? ''} ${categoryLabel(categoryOf(variant))}`);
    if (!words.every(word => text.includes(word))) return false;
    if (filters.source !== 'all' && isCustomVariant(variant.id) !== (filters.source === 'custom')) return false;
    if (filters.holeCards && variant.structure.holeCards !== Number(filters.holeCards)) return false;
    if (filters.limit && variant.betting.limit !== filters.limit) return false;
    const cards = deckSize(variant.deck);
    return filters.deck === 'all' || (filters.deck === 'short' ? cards < 52 : filters.deck === 'standard' ? cards === 52 : cards > 52);
  });
}
