import { useEffect, useId, useRef, type ReactNode } from 'react';

/** 卓を押し下げない情報パネル。長い内容はパネル内だけでスクロールする。 */
export function GameDialog({ title, children, onClose, className = '', anchor, initialFocus }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
  readonly anchor?: HTMLElement | null;
  readonly initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    const position = () => {
      if (!element || !anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const width = element.getBoundingClientRect().width;
      const top = Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - Math.min(540, window.innerHeight - 24) - 12));
      element.style.inset = 'auto';
      element.style.top = `${top}px`;
      element.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
      element.style.maxHeight = `${window.innerHeight - top - 12}px`;
    };
    position();
    if (initialFocus) element?.querySelector<HTMLElement>(initialFocus)?.focus();
    window.addEventListener('resize', position);
    return () => { window.removeEventListener('resize', position); element?.close(); };
  }, [anchor, initialFocus]);
  return (
    <dialog ref={ref} className={`game-dialog ${className}`} aria-labelledby={headingId}
      onClose={() => { if (!ref.current?.open) onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
          ref.current?.close();
      }}>
      <div className="game-dialog-head">
        <h2 id={headingId}>{title}</h2>
        <button type="button" className="btn btn-muted btn-small" onClick={() => ref.current?.close()} autoFocus>閉じる</button>
      </div>
      <div className="game-dialog-body">{children}</div>
    </dialog>
  );
}
