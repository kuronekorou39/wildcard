import { useSyncExternalStore } from 'react';
import {
  VARIANT_PRESETS,
  parseVariant,
  validateVariant,
  variantToJson,
  type Variant,
} from '@wildcard/engine';

/**
 * 自分で作ったルールの保管。
 *
 * サーバーを持たないので、置き場所はこの端末の localStorage しかない。
 * 読むときは必ず parseVariant を通す——**保存したデータは「外から来た JSON」** で、
 * 前のバージョンで保存したものや、手で書き換えられたものが入っていることがある。
 *
 * オンラインでは、ホストが選んだ Variant が卓の state ごとガイドへ届く。
 * ガイド側にそのルールが保存されていなくても遊べる（→ transport/）。
 */

const KEY = 'wildcard.variants.v1';

/** 自作ルールの id に必ず付く印。プリセットと衝突させないため。 */
export const CUSTOM_PREFIX = 'custom:';

export const isCustomVariant = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

/** 保存のたびに作り直す。useSyncExternalStore は同じ参照を返す必要がある。 */
let cachedCustom: readonly Variant[] | null = null;
let cachedAll: readonly Variant[] | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  cachedCustom = null;
  cachedAll = null;
  for (const listener of listeners) listener();
}

/** localStorage は使えないことがある（プライベートモード・設定で無効）。 */
function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(): Variant[] {
  const store = storage();
  if (!store) return [];

  let raw: string | null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn('保存されたルールが JSON として読めない。無視する。');
    return [];
  }

  const list = (data as { variants?: unknown })?.variants;
  if (!Array.isArray(list)) return [];

  const out: Variant[] = [];
  for (const item of list) {
    const result = parseVariant(item);
    if (!result.ok) {
      // 1つ壊れていても、他のルールは失わない。
      console.warn('読めないルールを飛ばした:', result.problems.join(' / '));
      continue;
    }
    out.push(result.variant);
  }
  return out;
}

function write(variants: readonly Variant[]): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify({ version: 1, variants }));
  } catch (error) {
    console.warn('ルールを保存できなかった:', error);
    return false;
  }
  notify();
  return true;
}

export function customVariants(): readonly Variant[] {
  cachedCustom ??= read();
  return cachedCustom;
}

/** プリセットと自作をまとめたもの。選択肢に出すのはこれ。 */
export function allVariants(): readonly Variant[] {
  cachedAll ??= [...VARIANT_PRESETS, ...customVariants()];
  return cachedAll;
}

/** id から引く。findVariant と違い、自作ルールも見つかる。 */
export const resolveVariant = (id: string): Variant | undefined =>
  allVariants().find((variant) => variant.id === id);

export function saveCustomVariant(variant: Variant): boolean {
  const list = customVariants();
  const at = list.findIndex((v) => v.id === variant.id);
  return write(at >= 0 ? list.map((v, i) => (i === at ? variant : v)) : [...list, variant]);
}

export function deleteCustomVariant(id: string): boolean {
  return write(customVariants().filter((variant) => variant.id !== id));
}

/**
 * 新しい id。
 *
 * 時刻だけでは足りない。取り込みを続けて行うと同じミリ秒に収まり、
 * 乱数2文字では 50個も作れば衝突する（実際にテストで出た）。
 * **通し番号を混ぜて、同じセッションでは必ず別の id になる**ようにしてある。
 * 時刻と乱数は、別のセッションや別の端末とぶつからないためのもの。
 *
 * crypto.randomUUID は使えないことがある（http:// で開いたとき）。
 * 同じ LAN で遊ぶ使い方を想定しているので、当てにしない。
 */
let created = 0;

export const newCustomId = (): string =>
  `${CUSTOM_PREFIX}${Date.now().toString(36)}-${(created++).toString(36)}-${Math.floor(
    Math.random() * 46656,
  )
    .toString(36)
    .padStart(3, '0')}`;

/**
 * 貼り付けられたルールを取り込む。
 *
 * 他人が作ったルールは id がぶつかりうるし、プリセットの id を名乗ることも
 * できてしまう。**必ず新しい id を振り直す。**
 */
export function importVariant(
  text: string,
  players = 2,
): { readonly ok: true; readonly variant: Variant } | { readonly ok: false; readonly problems: readonly string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`JSON として読めない: ${(error as Error).message}`] };
  }

  const parsed = parseVariant(data);
  if (!parsed.ok) return parsed;

  const problems = validateVariant(parsed.variant, players);
  if (problems.length > 0) {
    return { ok: false, problems: problems.map((p) => `${p.field}: ${p.message}`) };
  }

  const variant: Variant = { ...parsed.variant, id: newCustomId() };
  if (!saveCustomVariant(variant)) return { ok: false, problems: ['ルールを保存できませんでした。ブラウザの保存容量・設定を確認してください。'] };
  return { ok: true, variant };
}

/** 書き出し。貼り付けて渡せる形。 */
export const exportVariant = (variant: Variant): string => variantToJson(variant);

/**
 * 保存を読み直す。
 *
 * 別のタブで作ったルールを、こちらのタブにも出すために要る。
 * 保存先が1つしかない（この端末の localStorage）以上、
 * 同じ人が2つのタブを開いているのは普通に起きる。
 */
export const refreshVariants = (): void => notify();

let watching = false;

function watchOtherTabs(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('storage', (event) => {
    // key が null なのは「全部消した」とき。
    if (event.key === null || event.key === KEY) refreshVariants();
  });
}

function subscribe(listener: () => void): () => void {
  watchOtherTabs();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 画面から使う。保存されたら再描画される。 */
export const useVariants = (): readonly Variant[] =>
  useSyncExternalStore(subscribe, allVariants, allVariants);

export const useCustomVariants = (): readonly Variant[] =>
  useSyncExternalStore(subscribe, customVariants, customVariants);
