import type { Variant } from '@wildcard/engine';
import { isCustomVariant } from './customVariants.js';

/**
 * ルール選択の一覧の見出し。
 *
 * 分類は見せ方の都合なので、エンジンの Variant には持たせず、プリセットの id から引く。
 * 自作のルールはまとめて「自作」にする（先頭に置く。自分で作ったものを探すことが多い）。
 */
export const RULE_CATEGORIES = [
  ['custom', '自作'],
  ['classic', '定番'],
  ['game', '別のゲーム'],
  ['hands', 'ローカル役'],
  ['wild', 'ワイルド'],
  ['betting', '賭け方'],
  ['table', '卓の作法'],
] as const;
export type RuleCategory = typeof RULE_CATEGORIES[number][0];

const PRESET_CATEGORY: Readonly<Record<string, RuleCategory>> = {
  standard: 'classic',
  omaha: 'classic',
  'fixed-limit': 'classic',
  'pot-limit-holdem': 'classic',
  'big-o': 'game',
  'omaha-6': 'game',
  'short-deck': 'game',
  manila: 'game',
  'royal-holdem': 'game',
  greek: 'game',
  'super-holdem': 'game',
  tahoe: 'game',
  'six-card-flop': 'game',
  'ace-low': 'game',
  'flush-over-boat': 'hands',
  'suit-ranked': 'hands',
  'house-hands': 'hands',
  prime: 'hands',
  'skeets-dogs': 'hands',
  blaze: 'hands',
  'red-black': 'hands',
  'flush-house': 'hands',
  bobtail: 'hands',
  wraparound: 'hands',
  'joker-wild': 'wild',
  'two-jokers': 'wild',
  'japanese-home': 'wild',
  'deuces-wild': 'wild',
  'one-eyed-jacks': 'wild',
  baseball: 'wild',
  'dr-pepper': 'wild',
  straddle: 'betting',
  'no-preflop-allin': 'betting',
  casual: 'table',
  'run-it-thrice': 'table',
  'clumsy-dealer': 'table',
};

export function categoryOf(variant: Variant): RuleCategory {
  if (isCustomVariant(variant.id)) return 'custom';
  return PRESET_CATEGORY[variant.id] ?? 'classic';
}

export const categoryLabel = (category: RuleCategory): string =>
  RULE_CATEGORIES.find(([id]) => id === category)?.[1] ?? '';

/** 見出しの順に分ける。中の並びは渡された順のまま。空の分類は出さない。 */
export function groupVariants(variants: readonly Variant[]): readonly { readonly category: RuleCategory; readonly label: string; readonly variants: readonly Variant[] }[] {
  return RULE_CATEGORIES
    .map(([category, label]) => ({ category, label, variants: variants.filter((variant) => categoryOf(variant) === category) }))
    .filter((group) => group.variants.length > 0);
}
