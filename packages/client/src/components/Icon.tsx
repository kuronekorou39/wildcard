/** 文字記号（⌄ ✓ → など）の代わりに使う線画アイコン。サイズは font-size に追従する。 */
export function Icon({ kind, className = '' }: {
  readonly kind: 'close' | 'plus' | 'minus' | 'chevron-down' | 'chevron-right' | 'check' | 'info' | 'external' | 'arrow-right' | 'arrow-left';
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
  };
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[kind]}</svg>;
}
