import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';

/** 説明が画面の端に寄りすぎないための余白。 */
const EDGE = 8;

/**
 * 「i」の小さなボタン。押すと補足の説明をその場に出す。
 * 外を押すか Esc で閉じる。説明は読み上げでもボタンの説明として届く。
 * 説明は画面からはみ出さないよう、開いたときに横へずらす。
 */
export function InfoTip({ label, children }: { readonly label: string; readonly children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
  }, [open]);
  useLayoutEffect(() => {
    const element = body.current;
    if (!open || !element) return;
    element.style.translate = '';
    const rect = element.getBoundingClientRect();
    const shift = rect.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - rect.right : rect.left < EDGE ? EDGE - rect.left : 0;
    if (shift !== 0) element.style.translate = `${shift}px 0`;
  }, [open]);
  return <span ref={root} className="info-tip">
    <button type="button" className="info-tip-button" aria-label={`${label}の説明`} aria-expanded={open} aria-describedby={id} onClick={() => setOpen(!open)}><Icon kind="info" /></button>
    <span ref={body} id={id} role="tooltip" className="info-tip-body" hidden={!open}>{children}</span>
  </span>;
}
