/** 文字記号（⌄ ✓ → など）の代わりに使う線画アイコン。サイズは font-size に追従する。 */
export function Icon({ kind, className = '' }: {
  readonly kind: 'close' | 'plus' | 'minus' | 'chevron-down' | 'chevron-right' | 'check' | 'info' | 'external' | 'arrow-right' | 'arrow-left'
    | 'gauge-low' | 'gauge-mid' | 'gauge-high' | 'shuffle' | 'reorder' | 'edit' | 'chevron-up';
  readonly className?: string;
}) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    'chevron-right': <path d="m9 6 6 6-6 6" />,
    check: <path d="m5 12 5 5L20 7" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
    external: <path d="M7 17 17 7M9 7h8v8" />,
    'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
    'arrow-left': <path d="M19 12H5m6 6-6-6 6-6" />,
    // CPU の打ち方：メーターの針が左（慎重）・上（標準）・右（強気）
    'gauge-low': <><path d="M4 17a8 8 0 0 1 16 0" /><path d="M12 17 6.5 13" /><circle cx="12" cy="17" r="1" /></>,
    'gauge-mid': <><path d="M4 17a8 8 0 0 1 16 0" /><path d="M12 17v-7" /><circle cx="12" cy="17" r="1" /></>,
    'gauge-high': <><path d="M4 17a8 8 0 0 1 16 0" /><path d="m12 17 5.5-4" /><circle cx="12" cy="17" r="1" /></>,
    shuffle: <path d="M4 7h3l10 10h3M4 17h3l2.5-2.5M14 9.5 17 7h3m-3-3 3 3-3 3m0 4 3 3-3 3" />,
    // 並べ替え：左右に入れ替わる矢印
    reorder: <path d="M5 8h14m0 0-3-3m3 3-3 3M19 16H5m0 0 3-3m-3 3 3 3" />,
    edit: <path d="m15 5 4 4M5 15 15 5a2.8 2.8 0 0 1 4 4L9 19l-5 1z" />,
    'chevron-up': <path d="m6 15 6-6 6 6" />,
  };
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[kind]}</svg>;
}
