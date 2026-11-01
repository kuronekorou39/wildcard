import { useSyncExternalStore } from 'react';

// 先頭の5色は保存済みのデータが使っているので、名前も順番も変えない。
export const BANNER_TONES = ['wine', 'forest', 'slate', 'copper', 'plum', 'crimson', 'mustard', 'olive', 'teal', 'navy', 'indigo', 'charcoal'] as const;
export type BannerTone = typeof BANNER_TONES[number];
export const BANNER_TONE_LABELS: Record<BannerTone, string> = {
  wine: 'ワイン', forest: 'フォレスト', slate: 'スレート', copper: 'カッパー', plum: 'プラム', crimson: 'クリムゾン',
  mustard: 'マスタード', olive: 'オリーブ', teal: 'ティール', navy: 'ネイビー', indigo: 'インディゴ', charcoal: 'チャコール',
};
export const BANNER_MOTIFS = ['cards', 'chips', 'felt', 'suits', 'deco', 'joker', 'numeral'] as const;
export type BannerMotif = typeof BANNER_MOTIFS[number];
export const BANNER_MOTIF_LABELS: Record<BannerMotif, string> = {
  cards: '札の扇', chips: 'チップの山', felt: 'フェルト', suits: 'スート柄', deco: 'アールデコ', joker: 'ジョーカー', numeral: '大きな数字',
};
export interface RuleBannerStyle { readonly tone: BannerTone; readonly motif: BannerMotif; readonly image?: string }

/** 用意したルールの見た目。一覧の並び順に書き、隣り合うものが同じ色にならないようにしてある。 */
const PRESET_BANNERS: Readonly<Record<string, readonly [BannerTone, BannerMotif]>> = {
  standard: ['wine', 'cards'],
  omaha: ['copper', 'cards'],
  'fixed-limit': ['slate', 'chips'],
  'pot-limit-holdem': ['mustard', 'chips'],
  'big-o': ['forest', 'numeral'],
  'omaha-6': ['plum', 'numeral'],
  'short-deck': ['navy', 'numeral'],
  manila: ['copper', 'numeral'],
  'royal-holdem': ['mustard', 'deco'],
  greek: ['teal', 'cards'],
  'super-holdem': ['indigo', 'numeral'],
  tahoe: ['olive', 'cards'],
  'six-card-flop': ['forest', 'felt'],
  'ace-low': ['charcoal', 'deco'],
  'flush-over-boat': ['slate', 'suits'],
  'suit-ranked': ['indigo', 'suits'],
  'house-hands': ['plum', 'deco'],
  prime: ['navy', 'cards'],
  'skeets-dogs': ['forest', 'suits'],
  blaze: ['crimson', 'deco'],
  'red-black': ['wine', 'suits'],
  'flush-house': ['copper', 'numeral'],
  bobtail: ['charcoal', 'suits'],
  wraparound: ['teal', 'cards'],
  'joker-wild': ['crimson', 'joker'],
  'two-jokers': ['navy', 'joker'],
  'japanese-home': ['wine', 'joker'],
  'deuces-wild': ['teal', 'joker'],
  'one-eyed-jacks': ['indigo', 'joker'],
  baseball: ['forest', 'joker'],
  'dr-pepper': ['copper', 'joker'],
  straddle: ['slate', 'chips'],
  'no-preflop-allin': ['mustard', 'chips'],
  casual: ['olive', 'felt'],
  'run-it-thrice': ['indigo', 'felt'],
  'clumsy-dealer': ['plum', 'felt'],
};
const KEY = 'wildcard.rule-banners.v1';
const listeners = new Set<() => void>();
let revision = 0;
let watching = false;
function notify() { revision++; listeners.forEach(listener => listener()); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching && typeof window !== 'undefined') {
    watching = true;
    window.addEventListener('storage', event => { if (event.key === null || event.key === KEY) notify(); });
  }
  return () => { listeners.delete(listener); };
}
function read(): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}');
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch { return {}; }
}
/** 色を増やす前から決まっていた5色。知らない id の既定色がこれまでと変わらないよう、ハッシュはこの中から選ぶ。 */
const LEGACY_TONE_COUNT = 5;
export function defaultRuleBanner(id: string): RuleBannerStyle {
  const preset = Object.hasOwn(PRESET_BANNERS, id) ? PRESET_BANNERS[id] : undefined;
  if (preset) return { tone: preset[0], motif: preset[1] };
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { tone: BANNER_TONES[hash % LEGACY_TONE_COUNT]!, motif: 'cards' };
}
export function ruleBanner(id: string): RuleBannerStyle {
  const raw = read()[id] as Partial<Record<keyof RuleBannerStyle, unknown>> | undefined;
  if (!raw || typeof raw !== 'object' || !BANNER_TONES.includes(raw.tone as BannerTone)) return defaultRuleBanner(id);
  const tone = raw.tone as BannerTone;
  // 絵柄を選べるようになる前に保存したもの（{ tone } だけ）は、そのルールの既定の絵柄で描く。
  const motif = BANNER_MOTIFS.includes(raw.motif as BannerMotif) ? raw.motif as BannerMotif : defaultRuleBanner(id).motif;
  const image = typeof raw.image === 'string' && raw.image.length <= 600_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.image) ? raw.image : undefined;
  return image ? { tone, motif, image } : { tone, motif };
}
export function saveRuleBanner(id: string, style: RuleBannerStyle): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: style }));
    notify();
    return true;
  } catch { return false; }
}
export function useRuleBanner(id: string): RuleBannerStyle {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  return ruleBanner(id);
}

/** Keep uploads local and small; only decoded, rasterised image pixels are stored. */
export async function readBannerFile(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG・JPEG・WebP の画像を選んでください。');
  if (file.size > 10 * 1024 * 1024) throw new Error('10MB 以下の画像を選んでください。');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 400;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を読み込めませんでした。');
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    context.drawImage(bitmap, (canvas.width - bitmap.width * scale) / 2, (canvas.height - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    const result = canvas.toDataURL('image/webp', .8);
    if (result.length > 600_000) throw new Error('画像が大きすぎます。よりシンプルな画像を選んでください。');
    return result;
  } finally { bitmap.close(); }
}
