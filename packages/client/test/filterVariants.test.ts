import { describe, expect, it } from 'vitest';
import { findVariant, type Variant } from '@wildcard/engine';
import { EMPTY_RULE_FILTERS, filterVariants } from '../src/rules/filterVariants.js';

const standard = findVariant('standard')!;
const omaha = findVariant('omaha')!;
const custom: Variant = { ...standard, id: 'custom:test', name: 'ABC 卓', description: '友人用 テスト', deck: { ...standard.deck, jokers: 1 } };
const variants = [standard, omaha, custom];

describe('ルールの絞り込み', () => {
  it('全角文字と大文字小文字を揃え、複数語すべてで検索する', () => {
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, query: 'ａｂｃ　友人用' })).toEqual([custom]);
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, query: 'ABC 見つからない' })).toEqual([]);
  });
  it('自作と既定を区別する', () => {
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, source: 'custom' })).toEqual([custom]);
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, source: 'preset' })).toEqual([standard, omaha]);
  });
  it('手札・デッキ・ベット形式を組み合わせる', () => {
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, holeCards: '4', deck: 'standard', limit: omaha.betting.limit })).toEqual([omaha]);
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, holeCards: '4', deck: 'large' })).toEqual([]);
    expect(filterVariants(variants, { ...EMPTY_RULE_FILTERS, deck: 'large' })).toEqual([custom]);
  });
  it('条件を解除すると元の順序に戻る', () => {
    expect(filterVariants(variants, EMPTY_RULE_FILTERS)).toEqual(variants);
  });
});
