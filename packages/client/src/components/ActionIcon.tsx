export function ActionIcon({ kind }: { readonly kind: 'fold' | 'check' | 'call' | 'raise' | 'cancel' | 'play' | 'next' | 'pause' | 'result' }) {
  const paths = {
    fold: <><rect x="5" y="3" width="11" height="15" rx="2" transform="rotate(-12 10 10)" /><path d="M12 13h9m-3-3 3 3-3 3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    call: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v5c0 4 16 4 16 0V6M4 11v5c0 4 16 4 16 0v-5" /></>,
    raise: <><path d="m6 10 6-6 6 6M12 4v13M5 21h14" /></>,
    cancel: <path d="m6 6 12 12M18 6 6 18" />,
    play: <path d="m8 4 12 8-12 8Z" />,
    next: <><path d="m5 5 10 7-10 7ZM19 5v14" /></>,
    pause: <path d="M8 5v14M16 5v14" />,
    result: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}
