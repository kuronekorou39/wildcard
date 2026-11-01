import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.js';

/** 説明と画面の端のあいだに残す余白。 */
const EDGE = 8;
/** ボタンと説明のあいだ。 */
const GAP = 6;

/**
 * 「i」の小さなボタン。押すと補足の説明をその場に出す。
 * 外を押すか Esc で閉じる。説明は読み上げでもボタンの説明として届く。
 *
 * 説明は body（モーダルの中なら、その dialog）に直接描く。スクロールする枠の中に描くと、枠の端で切れてしまう。
 * 位置はボタンから計算し、上下左右とも画面の内側に収める（下に入らなければ上に出す）。
 */
export function InfoTip({ label, children }: { readonly label: string; readonly children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !body.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    // スクロールすると説明がボタンから離れて見えるので、閉じる。
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const element = body.current, anchor = button.current;
    if (!open || !element || !anchor) return;
    const at = anchor.getBoundingClientRect();
    const size = element.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(at.left - 4, window.innerWidth - EDGE - size.width));
    const below = at.bottom + GAP;
    const top = below + size.height <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - size.height);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.visibility = 'visible';
  }, [open]);

  return <span className="info-tip">
    <button ref={button} type="button" className="info-tip-button" aria-label={`${label}の説明`} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen(!open)}><Icon kind="info" /></button>
    {open && createPortal(<span ref={body} id={id} role="tooltip" className="info-tip-body">{children}</span>, button.current?.closest('dialog') ?? document.body)}
  </span>;
}
