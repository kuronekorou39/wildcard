import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STANDARD_VARIANT, VARIANT_PRESETS, variantToJson, type Variant } from '@wildcard/engine';
import {
  CUSTOM_PREFIX,
  allVariants,
  customVariants,
  deleteCustomVariant,
  exportVariant,
  importVariant,
  isCustomVariant,
  newCustomId,
  refreshVariants,
  resolveVariant,
  saveCustomVariant,
} from '../src/rules/customVariants.js';

/**
 * 保存まわり。
 *
 * **保存したデータは「外から来た JSON」**として扱う。前のバージョンで
 * 保存したもの、手で書き換えられたもの、容量超過で途中まで書かれたもの——
 * どれが来ても、遊べなくならないことを確かめる。
 */

/** テスト用の localStorage。window ごと差し替える。 */
class FakeStorage {
  private readonly map = new Map<string, string>();
  throwOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.throwOnWrite) throw new Error('容量超過');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get length(): number {
    return this.map.size;
  }
  key(): string | null {
    return null;
  }
}

let store: FakeStorage;

const custom = (patch: Partial<Variant> = {}): Variant => ({
  ...STANDARD_VARIANT,
  id: newCustomId(),
  name: '自作ルール',
  ...patch,
});

beforeEach(() => {
  store = new FakeStorage();
  vi.stubGlobal('window', { localStorage: store, addEventListener: () => {} });
  refreshVariants();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refreshVariants();
});

describe('保存と読み出し', () => {
  it('保存したものが読める', () => {
    const variant = custom({ name: '六枚フロップ' });
    saveCustomVariant(variant);
    refreshVariants();
    expect(customVariants()).toEqual([variant]);
  });

  it('同じ id は上書きする', () => {
    const variant = custom();
    saveCustomVariant(variant);
    saveCustomVariant({ ...variant, name: '直した' });
    refreshVariants();
    expect(customVariants()).toHaveLength(1);
    expect(customVariants()[0]!.name).toBe('直した');
  });

  it('消せる', () => {
    const variant = custom();
    saveCustomVariant(variant);
    deleteCustomVariant(variant.id);
    refreshVariants();
    expect(customVariants()).toEqual([]);
  });

  it('プリセットと並べて出す', () => {
    const variant = custom();
    saveCustomVariant(variant);
    refreshVariants();
    expect(allVariants()).toHaveLength(VARIANT_PRESETS.length + 1);
    expect(resolveVariant(variant.id)).toEqual(variant);
    expect(resolveVariant('standard')).toEqual(STANDARD_VARIANT);
    expect(resolveVariant('知らないid')).toBeUndefined();
  });
});

describe('壊れた保存でも遊べなくならない', () => {
  it('localStorage が使えない', () => {
    // プライベートモードでは window.localStorage を読むだけで投げる。
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('使えない');
      },
      addEventListener: () => {},
    });
    refreshVariants();
    expect(customVariants()).toEqual([]);
    expect(() => saveCustomVariant(custom())).not.toThrow();
  });

  it('JSON として壊れている', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.setItem('wildcard.variants.v1', '{ 壊れている');
    refreshVariants();
    expect(customVariants()).toEqual([]);
  });

  it('1つ壊れていても、他のルールは失わない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = custom({ name: '無事なほう' });
    store.setItem(
      'wildcard.variants.v1',
      JSON.stringify({ version: 1, variants: [{ id: 'こわれ', name: 42 }, good] }),
    );
    refreshVariants();
    expect(customVariants().map((v) => v.name)).toEqual(['無事なほう']);
  });

  it('書けなくても投げない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.throwOnWrite = true;
    expect(() => saveCustomVariant(custom())).not.toThrow();
    expect(saveCustomVariant(custom())).toBe(false);
    expect(customVariants()).toEqual([]);
  });
});

describe('受け渡し', () => {
  it('保存できなければ取り込み成功と報告しない', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.throwOnWrite = true;
    const result = importVariant(exportVariant(STANDARD_VARIANT));
    expect(result.ok).toBe(false);
    expect(customVariants()).toEqual([]);
  });
  it('書き出して取り込める', () => {
    const result = importVariant(exportVariant(STANDARD_VARIANT));
    expect(result.ok, result.ok ? '' : result.problems.join(' / ')).toBe(true);
    if (!result.ok) return;
    expect(result.variant.ranking).toEqual(STANDARD_VARIANT.ranking);
    refreshVariants();
    expect(customVariants()).toHaveLength(1);
  });

  it('取り込むと id を振り直す', () => {
    // プリセットの id を名乗るルールを渡されても、上書きできてはいけない。
    const result = importVariant(variantToJson({ ...STANDARD_VARIANT, name: 'なりすまし' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variant.id).not.toBe('standard');
    expect(isCustomVariant(result.variant.id)).toBe(true);
    expect(resolveVariant('standard')).toEqual(STANDARD_VARIANT);
  });

  it('同じものを2回取り込むと2つになる', () => {
    // id を振り直す以上、こうなるのが筋。片方を消せばよい。
    importVariant(exportVariant(STANDARD_VARIANT));
    importVariant(exportVariant(STANDARD_VARIANT));
    refreshVariants();
    expect(customVariants()).toHaveLength(2);
  });

  it('形が壊れていれば取り込まない', () => {
    const result = importVariant('{"id":"x"}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.length).toBeGreaterThan(0);
    refreshVariants();
    expect(customVariants()).toEqual([]);
  });

  it('形は正しくても遊べないものは取り込まない', () => {
    // 2人で配りきれないデッキ。形の検査（parseVariant）では通る。
    const tiny = variantToJson({
      ...STANDARD_VARIANT,
      deck: { suits: ['spades'], ranks: ['A'] },
    });
    const result = importVariant(tiny);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(' ')).toContain('枚');
  });

  it('JSON でなければ理由を返す', () => {
    const result = importVariant('これはルールではない');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]).toContain('JSON');
  });
});

describe('id の決まり', () => {
  it('自作には印が付く', () => {
    expect(newCustomId().startsWith(CUSTOM_PREFIX)).toBe(true);
    expect(isCustomVariant('standard')).toBe(false);
  });

  it('続けて作っても重ならない', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCustomId()));
    expect(ids.size).toBe(50);
  });
});
