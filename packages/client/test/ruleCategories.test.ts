import { describe, expect, it } from 'vitest';
import { VARIANT_PRESETS, STANDARD_VARIANT } from '@wildcard/engine';
import { categoryOf, groupVariants } from '../src/rules/ruleCategories.js';

describe('ルールの分類', () => {
  it('標準以外の「定番」は決めたものだけ', () => {
    // 新しいプリセットを足したのに分類を書き忘れると、黙って「定番」に入ってしまう。
    const classic = VARIANT_PRESETS.filter((variant) => categoryOf(variant) === 'classic').map((variant) => variant.id);
    expect(classic).toEqual(['standard', 'omaha', 'fixed-limit', 'pot-limit-holdem']);
  });

  it('自作は先頭の「自作」にまとまる', () => {
    const custom = { ...STANDARD_VARIANT, id: 'custom:abc', name: '自分の' };
    const groups = groupVariants([STANDARD_VARIANT, custom]);
    expect(groups.map((group) => group.label)).toEqual(['自作', '定番']);
  });

  it('空の分類は出さない', () => {
    expect(groupVariants([STANDARD_VARIANT]).map((group) => group.category)).toEqual(['classic']);
  });
});
