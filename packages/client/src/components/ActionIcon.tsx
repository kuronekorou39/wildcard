export function ActionIcon({ kind }: { readonly kind: 'fold' | 'check' | 'call' | 'raise' | 'cancel' }) {
  const paths = {
    fold: <><rect x="5" y="3" width="11" height="15" rx="2" transform="rotate(-12 10 10)" /><path d="M12 13h9m-3-3 3 3-3 3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    call: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v5c0 4 16 4 16 0V6M4 11v5c0 4 16 4 16 0v-5" /></>,
    raise: <><path d="m6 10 6-6 6 6M12 4v13M5 21h14" /></>,
    cancel: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}
