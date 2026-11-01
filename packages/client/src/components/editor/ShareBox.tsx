import { useEffect, useState } from 'react';
import type { Variant } from '@wildcard/engine';
import { exportVariant, readSharedVariant } from '../../rules/customVariants.js';
import { GameDialog } from '../GameDialog.js';

interface ShareBoxProps {
  readonly variant: Variant;
  /** 保存していない変更があるか。あれば取り込む前に確かめる。 */
  readonly dirty: boolean;
  /** 読めたルールを編集中のルールとして開く。渡さなければ取り込み欄を出さない。 */
  readonly onImport?: (variant: Variant) => void;
}

/** 「コピーしました」を出しておく時間。 */
const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * ルールの受け渡し。
 *
 * サーバーを持たないので、共有はテキストを渡すだけ。
 * 取り込む側では **id を必ず振り直す**（→ customVariants.ts）。
 * 他人のルールがプリセットの id を名乗って上書きできてしまうのを防ぐ。
 *
 * 取り込んだルールはすぐには保存しない。編集中のルールとして開き、
 * 矛盾があれば検証欄に出す。保存はほかの編集と同じく「保存」で行う。
 */
export function ShareBox({ variant, dirty, onImport }: ShareBoxProps) {
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [copy, setCopy] = useState<CopyState>('idle');
  const [pending, setPending] = useState<Variant | null>(null);
  const exported = exportVariant(variant);

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = window.setTimeout(() => setCopy('idle'), COPY_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copy]);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setCopy('copied');
    } catch {
      // クリップボードは許可されないことがある。その場合は欄から手で取ってもらう。
      setCopy('failed');
    }
  };

  const open = (next: Variant) => {
    setPending(null);
    setProblems([]);
    setText('');
    onImport?.(next);
  };

  const load = () => {
    const result = readSharedVariant(text);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    if (dirty) setPending(result.variant);
    else open(result.variant);
  };

  return (
    <section className="panel share-box" aria-label="受け渡し">
      <p className="hint share-note">ルールの内容を書き出します。バナーはこのブラウザだけの設定です。</p>

      <div className="field">
        <span className="field-label">このルールを渡す</span>
        <textarea
          className="input share-text"
          readOnly
          rows={4}
          value={exported}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="share-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { void copyText(); }}>
            {copy === 'copied' ? 'コピーしました' : 'コピー'}
          </button>
          {copy === 'failed' && <span className="share-feedback hint-warn" role="alert">コピーできませんでした。欄を選んで手でコピーしてください。</span>}
        </div>
      </div>

      {onImport !== undefined && (
        <div className="field">
          <span className="field-label">もらったルールを取り込む</span>
          <textarea
            className="input share-text"
            rows={4}
            value={text}
            placeholder="ここに貼り付け"
            onChange={(e) => { setText(e.target.value); setProblems([]); }}
          />
          <div className="share-actions">
            <button type="button" className="btn btn-ghost" disabled={text.trim() === ''} onClick={load}>
              取り込む
            </button>
          </div>
          <p className="hint share-hint">取り込んだルールは編集中のルールとして開きます。保存するまで一覧には入りません。</p>
          {problems.length > 0 && (
            <div className="share-error" role="alert">
              <p>このルールは読めませんでした。</p>
              <ul className="editor-problems">
                {problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {pending && (
        <GameDialog title="取り込みますか" className="editor-leave-dialog" onClose={() => setPending(null)}>
          <p className="hint">「{variant.name || '名前のないルール'}」の保存していない変更は消えます。</p>
          <div className="editor-leave-actions">
            <button type="button" className="btn btn-danger" onClick={() => open(pending)}>変更を捨てて取り込む</button>
            <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>やめる</button>
          </div>
        </GameDialog>
      )}
    </section>
  );
}
