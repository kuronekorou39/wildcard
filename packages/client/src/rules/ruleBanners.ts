import { useSyncExternalStore } from 'react';

export const BANNER_TONES = ['wine', 'forest', 'slate', 'copper', 'plum'] as const;
export type BannerTone = typeof BANNER_TONES[number];
export interface RuleBannerStyle { readonly tone: BannerTone; readonly image?: string }
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
export function defaultRuleBanner(id: string): RuleBannerStyle {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { tone: id === 'standard' ? 'wine' : BANNER_TONES[hash % BANNER_TONES.length]! };
}
export function ruleBanner(id: string): RuleBannerStyle {
  const raw = read()[id] as Partial<RuleBannerStyle> | undefined;
  if (!raw || !BANNER_TONES.includes(raw.tone as BannerTone)) return defaultRuleBanner(id);
  const image = typeof raw.image === 'string' && raw.image.length <= 600_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.image) ? raw.image : undefined;
  return image ? { tone: raw.tone!, image } : { tone: raw.tone! };
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
