import { useEffect, useId, useRef, type ReactNode } from 'react';

/** 卓を押し下げない情報パネル。長い内容はパネル内だけでスクロールする。 */
export function GameDialog({ title, children, onClose, className = '' }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
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
