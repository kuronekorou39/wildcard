import { useId } from 'react';
import type { TableShape } from '../tableAppearance.js';

const OUTLINES: Record<TableShape, string> = {
  racetrack: 'M190 18 H810 Q982 18 982 180 V420 Q982 582 810 582 H190 Q18 582 18 420 V180 Q18 18 190 18 Z',
  oval: 'M500 18 C770 18 982 144 982 300 C982 456 770 582 500 582 C230 582 18 456 18 300 C18 144 230 18 500 18 Z',
  perspective: 'M222 18 H778 Q847 18 865 85 L974 481 Q1002 582 887 582 H113 Q-2 582 26 481 L135 85 Q153 18 222 18 Z',
};

export function TableFelt({ shape }: { readonly shape: TableShape }) {
  const gradientId = useId();
  const railId = useId();
  return (
    <svg className="table-felt" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor="#3d353a" />
          <stop offset="1" stopColor="#302a2e" />
        </radialGradient>
        <linearGradient id={railId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#393038" />
          <stop offset="1" stopColor="#282125" />
        </linearGradient>
      </defs>
      {/* The top covers the rear of this extrusion; only the near edge has a visible side. */}
      <path d={OUTLINES[shape]} transform="translate(0 16)" fill="#171316" />
      <path d={OUTLINES[shape]} fill={`url(#${railId})`} stroke="#66545c" strokeWidth="1.5" />
      {/* Six units of rail at the far edge, a wider rail towards the viewer. */}
      <path d={OUTLINES[shape]} transform="translate(0 6) translate(500 18) scale(.955 .94) translate(-500 -18)"
        fill={`url(#${gradientId})`} stroke="#9c827a" strokeOpacity=".22" strokeWidth="1.5" />
    </svg>
  );
}
