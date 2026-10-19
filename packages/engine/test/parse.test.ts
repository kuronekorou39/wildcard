import { describe, expect, it } from 'vitest';
import { parseVariant, parseVariantJson, variantToJson } from '../src/rules/parse.js';
import { VARIANT_PRESETS } from '../src/rules/variants.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { validateVariant } from '../src/variant.js';

/** 壊れた入力を作るための、素の JSON 表現。 */
const asJson = (): Record<string, unknown> =>
  JSON.parse(variantToJson(STANDARD_VARIANT)) as Record<string, unknown>;

function problemsOf(data: unknown): readonly string[] {
  const result = parseVariant(data);
  if (result.ok) throw new Error('読めてしまった');
  return result.problems;
}

describe('書き出して読み返す', () => {
  it('どのプリセットも元に戻る', () => {
    // ここが通らないと、保存した自作ルールが読み込みで化ける。
    // プリセット全部を通すことで、使っている項目の取りこぼしを防ぐ。
    for (const variant of VARIANT_PRESETS) {
      const result = parseVariantJson(variantToJson(variant));
      expect(result.ok, `${variant.name}: ${result.ok ? '' : result.problems.join(' / ')}`).toBe(
        true,
      );
      if (result.ok) expect(result.variant).toEqual(variant);
    }
  });

  it('読み返したものがそのまま遊べる', () => {
    for (const variant of VARIANT_PRESETS) {
      const result = parseVariantJson(variantToJson(variant));
      if (!result.ok) throw new Error(result.problems.join(' / '));
      expect(validateVariant(result.variant, 2)).toEqual([]);
    }
  });
});

describe('壊れた入力でも落ちない', () => {
  it('JSON として壊れている', () => {
    const result = parseVariantJson('{ これは JSON ではない');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('JSON として読めない');
  });

  it('そもそもオブジェクトでない', () => {
    for (const value of [null, 42, 'ルール', [], undefined]) {
      expect(problemsOf(value)[0]).toContain('オブジェクトではない');
    }
  });

  it('空のオブジェクト', () => {
    // 落ちずに、何が足りないかを全部返す。
    const problems = problemsOf({});
    expect(problems.length).toBeGreaterThan(3);
    expect(problems.some((m) => m.startsWith('deck:'))).toBe(true);
    expect(problems.some((m) => m.startsWith('structure:'))).toBe(true);
  });

  it('問題を最初の1件で止めない', () => {
    // 編集画面に出すので、1つ直すたびに次の1つが出るのでは使いづらい。
    const broken = asJson();
    broken['id'] = 1;
    broken['name'] = null;
    const problems = problemsOf(broken);
    expect(problems.some((m) => m.startsWith('id:'))).toBe(true);
    expect(problems.some((m) => m.startsWith('name:'))).toBe(true);
  });
});

describe('知らない値を通さない', () => {
  it('デッキに無いランク', () => {
    const broken = asJson();
    (broken['deck'] as Record<string, unknown>)['ranks'] = ['2', 'Z', 'A'];
    expect(problemsOf(broken).some((m) => m.startsWith('deck.ranks[1]:'))).toBe(true);
  });

  it('知らないスート', () => {
    const broken = asJson();
    (broken['deck'] as Record<string, unknown>)['suits'] = ['spades', 'swords'];
    expect(problemsOf(broken).some((m) => m.startsWith('deck.suits[1]:'))).toBe(true);
  });

  it('知らない役の条件', () => {
    const broken = asJson();
    const hands = (broken['ranking'] as { hands: Record<string, unknown>[] }).hands;
    hands[0]!['pattern'] = { cards: [{ rank: { type: '素数' }, suits: [] }], global: [] };
    expect(problemsOf(broken).some((m) => m.includes('.rank.type:'))).toBe(true);
  });

  it('知らない全体条件', () => {
    const broken = asJson();
    const hands = (broken['ranking'] as { hands: Record<string, unknown>[] }).hands;
    hands[0]!['pattern'] = { cards: [], global: [{ type: 'すべて赤' }] };
    expect(problemsOf(broken).some((m) => m.includes('知らない条件'))).toBe(true);
  });

  it('知らない制度', () => {
    const broken = asJson();
    (broken['betting'] as Record<string, unknown>)['limit'] = 'half-limit';
    expect(problemsOf(broken).some((m) => m.startsWith('betting.limit:'))).toBe(true);
  });

  it('数でない枚数', () => {
    const broken = asJson();
    (broken['structure'] as Record<string, unknown>)['holeCards'] = '2';
    expect(problemsOf(broken).some((m) => m.startsWith('structure.holeCards:'))).toBe(true);
  });

  it('NaN や Infinity も数として受けない', () => {
    // JSON には書けないが、オブジェクトを直接渡す経路では来る。
    const broken = asJson();
    (broken['structure'] as Record<string, unknown>)['handSize'] = Number.POSITIVE_INFINITY;
    expect(problemsOf(broken).some((m) => m.startsWith('structure.handSize:'))).toBe(true);
  });
});

describe('ゆるく読むところ', () => {
  it('知らない項目は無視する', () => {
    const data = asJson();
    data['将来の項目'] = { 何か: true };
    const result = parseVariant(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.variant).toEqual(STANDARD_VARIANT);
  });

  it('enabled の省略は「有効」と読む', () => {
    // 役を足したのに出てこない、のほうが分かりにくい。
    const data = asJson();
    const hands = (data['ranking'] as { hands: Record<string, unknown>[] }).hands;
    delete hands[0]!['enabled'];
    const result = parseVariant(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.variant.ranking.hands[0]!.enabled).toBe(true);
  });

  it('省略できる項目は省略できる', () => {
    const minimal = {
      id: 'minimal',
      name: '最小',
      deck: { suits: ['spades'], ranks: ['A'] },
      structure: { holeCards: 1, streets: [], handSize: 1 },
      betting: { limit: 'no-limit' },
      ranking: { hands: [{ id: 'high', name: 'ハイ', enabled: true, pattern: { cards: [] } }] },
    };
    const result = parseVariant(minimal);
    expect(result.ok, result.ok ? '' : result.problems.join(' / ')).toBe(true);
    if (result.ok) {
      expect(result.variant.options).toBeUndefined();
      expect(result.variant.ranking.wilds).toBeUndefined();
      expect(result.variant.ranking.hands[0]!.pattern.global).toEqual([]);
    }
  });
});
