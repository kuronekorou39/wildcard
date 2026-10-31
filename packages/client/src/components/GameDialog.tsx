import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.js';

/** 卓を押し下げない情報パネル。長い内容はパネル内だけでスクロールする。 */
export function GameDialog({ title, children, onClose, className = '', anchor, initialFocus, placement = 'auto', actions }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  /** 「閉じる」の左に並べる操作ボタン。 */
  readonly actions?: ReactNode;
  readonly className?: string;
  readonly anchor?: HTMLElement | null;
  readonly initialFocus?: string;
  /**
   * auto: anchor の下に出し、入らなければ上へずらす。
   * below: anchor の真下・左揃えに固定する。
   * under: anchor（ヘッダなど）の下に収め、横位置は CSS のまま。上下に同じ余白を残し、外側を押して閉じられるようにする。
   */
  readonly placement?: 'auto' | 'below' | 'under';
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
      const top = placement === 'auto'
        ? Math.max(12, Math.min(bounds.bottom + 8, window.innerHeight - Math.min(540, window.innerHeight - 24) - 12))
        : bounds.bottom + 8;
      // 下にも上と同じ余白を残す。範囲外を押して閉じる操作のため。
      const bottomGap = placement === 'auto' ? 12 : top;
      if (placement === 'under') {
        element.style.top = `${top}px`;
        element.style.bottom = 'auto';
      } else {
        element.style.inset = 'auto';
        element.style.top = `${top}px`;
        element.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12))}px`;
      }
      element.style.maxHeight = `${window.innerHeight - top - bottomGap}px`;
    };
    position();
    if (initialFocus) element?.querySelector<HTMLElement>(initialFocus)?.focus();
    window.addEventListener('resize', position);
    return () => { window.removeEventListener('resize', position); element?.close(); };
  }, [anchor, initialFocus, placement]);
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
        <div className="game-dialog-actions">
          {actions}
          <button type="button" className="btn btn-muted btn-small" onClick={() => ref.current?.close()} autoFocus><Icon kind="close" />閉じる</button>
        </div>
      </div>
      <div className="game-dialog-body">{children}</div>
    </dialog>
  );
}
