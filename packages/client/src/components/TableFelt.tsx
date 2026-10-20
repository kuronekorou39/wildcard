import { useId } from 'react';
import type { TableShape } from '../tableAppearance.js';

const OUTLINES: Record<TableShape, string> = {
  racetrack: 'M190 18 H810 Q982 18 982 180 V420 Q982 582 810 582 H190 Q18 582 18 420 V180 Q18 18 190 18 Z',
  oval: 'M500 18 C770 18 982 144 982 300 C982 456 770 582 500 582 C230 582 18 456 18 300 C18 144 230 18 500 18 Z',
  perspective: 'M222 18 H778 Q847 18 865 85 L974 481 Q1002 582 887 582 H113 Q-2 582 26 481 L135 85 Q153 18 222 18 Z',
};

export function TableFelt({ shape }: { readonly shape: TableShape }) {
  const gradientId = useId();
  return (
    <svg className="table-felt" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0" stopColor="#3d353a" />
          <stop offset="1" stopColor="#302a2e" />
        </radialGradient>
      </defs>
      <path d={OUTLINES[shape]} fill={`url(#${gradientId})`} stroke="#252124" strokeWidth="24" />
      <path d={OUTLINES[shape]} fill="none" stroke="#78646b" strokeOpacity=".5" strokeWidth="1.5" />
      <path d={OUTLINES[shape]} transform="translate(500 300) scale(.95 .94) translate(-500 -300)"
        fill="none" stroke="#dbc5a6" strokeOpacity=".13" strokeWidth="1" />
    </svg>
  );
}
