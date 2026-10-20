import { useState } from 'react';

export const TABLE_SHAPES = [
  { id: 'racetrack', name: 'ラウンドレクト', description: '直線を活かした、角の丸い卓' },
  { id: 'oval', name: 'オーバル', description: 'ゆったりした楕円の卓' },
  { id: 'perspective', name: 'パース', description: '奥が細く、手前が広い卓' },
] as const;
export type TableShape = typeof TABLE_SHAPES[number]['id'];
const STORAGE_KEY = 'wildcard.table-shape.v1';

export function useTableShape() {
  const [shape, setShape] = useState<TableShape>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return TABLE_SHAPES.find(({ id }) => id === saved)?.id ?? 'racetrack';
    } catch { return 'racetrack'; }
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const updateShape = (next: TableShape) => {
    setShape(next);
    try { localStorage.setItem(STORAGE_KEY, next); setSaveFailed(false); }
    catch { setSaveFailed(true); }
  };
  return { shape, updateShape, saveFailed };
}
