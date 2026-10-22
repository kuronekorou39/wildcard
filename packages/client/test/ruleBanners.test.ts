import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuleBanner, ruleBanner, saveRuleBanner } from '../src/rules/ruleBanners.js';

let values: Map<string, string>;
let setItem: ReturnType<typeof vi.fn>;
beforeEach(() => {
  values = new Map();
  setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem } });
});
afterEach(() => vi.unstubAllGlobals());

describe('local rule banners', () => {
  it('keeps each rule independent and survives a storage read', () => {
    const image = 'data:image/webp;base64,YQ==';
    expect(saveRuleBanner('standard', { tone: 'forest', image })).toBe(true);
    expect(saveRuleBanner('custom:test', { tone: 'plum' })).toBe(true);
    expect(ruleBanner('standard')).toEqual({ tone: 'forest', image });
    expect(ruleBanner('custom:test')).toEqual({ tone: 'plum' });
    expect(ruleBanner('unconfigured')).toEqual(defaultRuleBanner('unconfigured'));
  });
  it('ignores malformed storage and non-raster / remote sources', () => {
    values.set('wildcard.rule-banners.v1', '{broken');
    expect(ruleBanner('standard')).toEqual(defaultRuleBanner('standard'));
    for (const image of ['https://example.com/image.png', 'data:image/svg+xml;base64,YQ==', 'javascript:alert(1)', 'data:image/png;base64,' + 'x'.repeat(600_000)]) {
      values.set('wildcard.rule-banners.v1', JSON.stringify({ standard: { tone: 'wine', image } }));
      expect(ruleBanner('standard')).toEqual({ tone: 'wine' });
    }
  });
  it('reports quota failure without replacing the existing banner', () => {
    saveRuleBanner('standard', { tone: 'forest' });
    setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(saveRuleBanner('standard', { tone: 'wine' })).toBe(false);
    expect(ruleBanner('standard')).toEqual({ tone: 'forest' });
  });
});
