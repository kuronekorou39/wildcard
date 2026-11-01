import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VARIANT_PRESETS } from '@wildcard/engine';
import { BANNER_MOTIFS, BANNER_TONES, defaultRuleBanner, ruleBanner, saveRuleBanner } from '../src/rules/ruleBanners.js';

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
    expect(saveRuleBanner('standard', { tone: 'forest', motif: 'chips', image })).toBe(true);
    expect(saveRuleBanner('custom:test', { tone: 'navy', motif: 'deco' })).toBe(true);
    expect(ruleBanner('standard')).toEqual({ tone: 'forest', motif: 'chips', image });
    expect(ruleBanner('custom:test')).toEqual({ tone: 'navy', motif: 'deco' });
    expect(ruleBanner('unconfigured')).toEqual(defaultRuleBanner('unconfigured'));
  });
  it('ignores malformed storage and non-raster / remote sources', () => {
    values.set('wildcard.rule-banners.v1', '{broken');
    expect(ruleBanner('standard')).toEqual(defaultRuleBanner('standard'));
    for (const image of ['https://example.com/image.png', 'data:image/svg+xml;base64,YQ==', 'javascript:alert(1)', 'data:image/png;base64,' + 'x'.repeat(600_000)]) {
      values.set('wildcard.rule-banners.v1', JSON.stringify({ standard: { tone: 'wine', motif: 'felt', image } }));
      expect(ruleBanner('standard')).toEqual({ tone: 'wine', motif: 'felt' });
    }
  });
  it('reads banners saved before motifs existed, and rejects unknown motifs', () => {
    const image = 'data:image/webp;base64,YQ==';
    values.set('wildcard.rule-banners.v1', JSON.stringify({ 'joker-wild': { tone: 'plum' }, standard: { tone: 'slate', image }, 'custom:x': { tone: 'forest', motif: 'balloons' } }));
    expect(ruleBanner('joker-wild')).toEqual({ tone: 'plum', motif: 'joker' });
    expect(ruleBanner('standard')).toEqual({ tone: 'slate', motif: 'cards', image });
    expect(ruleBanner('custom:x')).toEqual({ tone: 'forest', motif: 'cards' });
  });
  it('gives every preset a valid default and keeps the old defaults for other ids', () => {
    expect(defaultRuleBanner('standard')).toEqual({ tone: 'wine', motif: 'cards' });
    for (const preset of VARIANT_PRESETS) {
      const style = defaultRuleBanner(preset.id);
      expect(BANNER_TONES).toContain(style.tone);
      expect(BANNER_MOTIFS).toContain(style.motif);
    }
    // 知らない id は前と同じく最初の5色から選ぶ
    expect(BANNER_TONES.slice(0, 5)).toContain(defaultRuleBanner('custom:abc').tone);
    expect(defaultRuleBanner('custom:abc').motif).toBe('cards');
    expect(defaultRuleBanner('toString')).toEqual(defaultRuleBanner('toString'));
  });
  it('reports quota failure without replacing the existing banner', () => {
    saveRuleBanner('standard', { tone: 'forest', motif: 'cards' });
    setItem.mockImplementation(() => { throw new Error('quota'); });
    expect(saveRuleBanner('standard', { tone: 'wine', motif: 'cards' })).toBe(false);
    expect(ruleBanner('standard')).toEqual({ tone: 'forest', motif: 'cards' });
  });
});
