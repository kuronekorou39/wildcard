import { createContext, useContext, useState, type ReactNode } from 'react';

export const FACE_STYLES = [
  { id: 'classic', name: 'クラシック', description: '対角の数字と中央のマーク' },
  { id: 'bold', name: 'ラージインデックス', description: '大きな数字で、読みやすく' },
  { id: 'four-color', name: '4カラー', description: 'スートを4色で見分ける' },
] as const;

export const BACK_STYLES = [
  { id: 'dragon', name: 'ドラゴン', description: 'いつものディーラーと一緒に' },
  { id: 'diamond', name: 'ダイヤモンド', description: '深い赤のクラシックな幾何柄' },
  { id: 'monogram', name: 'モノグラム', description: 'チャコールに、控えめな W' },
] as const;

export type FaceStyle = typeof FACE_STYLES[number]['id'];
export type BackStyle = typeof BACK_STYLES[number]['id'];
export interface CardAppearance {
  readonly face: FaceStyle;
  readonly back: BackStyle;
}

export const CARD_APPEARANCE_KEY = 'wildcard.card-appearance.v1';
export const DEFAULT_CARD_APPEARANCE: CardAppearance = { face: 'classic', back: 'dragon' };

/** 古い設定や壊れた保存値でも、それぞれの面を独立に復元する。 */
export function parseCardAppearance(value: string | null): CardAppearance {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CARD_APPEARANCE;
    const saved = parsed as Record<string, unknown>;
    return {
      face: FACE_STYLES.find((style) => style.id === saved.face)?.id ?? DEFAULT_CARD_APPEARANCE.face,
      back: BACK_STYLES.find((style) => style.id === saved.back)?.id ?? DEFAULT_CARD_APPEARANCE.back,
    };
  } catch {
    return DEFAULT_CARD_APPEARANCE;
  }
}

interface AppearanceContextValue {
  readonly appearance: CardAppearance;
  readonly updateAppearance: (patch: Partial<CardAppearance>) => void;
  readonly saveFailed: boolean;
}

const AppearanceContext = createContext<AppearanceContextValue>({
  appearance: DEFAULT_CARD_APPEARANCE,
  updateAppearance: () => {},
  saveFailed: false,
});

export function CardAppearanceProvider({ children }: { readonly children: ReactNode }) {
  const [appearance, setAppearance] = useState(() => {
    try {
      return parseCardAppearance(window.localStorage.getItem(CARD_APPEARANCE_KEY));
    } catch {
      return DEFAULT_CARD_APPEARANCE;
    }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const updateAppearance = (patch: Partial<CardAppearance>) => {
    const next = { ...appearance, ...patch };
    setAppearance(next);
    try {
      window.localStorage.setItem(CARD_APPEARANCE_KEY, JSON.stringify(next));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  };
  return (
    <AppearanceContext.Provider value={{ appearance, updateAppearance, saveFailed }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export const useCardAppearance = () => useContext(AppearanceContext);
