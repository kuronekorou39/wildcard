import { useState } from 'react';
import type { Variant } from '@wildcard/engine';
import { exportVariant, importVariant } from '../../rules/customVariants.js';

interface ShareBoxProps {
  readonly variant: Variant;
  /** 取り込んだルールを開く。渡さなければ取り込み欄を出さない。 */
  readonly onImported?: (variantId: string) => void;
}

/**
 * ルールの受け渡し。
 *
 * サーバーを持たないので、共有はテキストを渡すだけ。
 * 取り込む側では **id を必ず振り直す**（→ customVariants.ts）。
 * 他人のルールがプリセットの id を名乗って上書きできてしまうのを防ぐ。
 */
export function ShareBox({ variant, onImported }: ShareBoxProps) {
  const [text, setText] = useState('');
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportVariant(variant));
      setCopied(true);
    } catch {
      // クリップボードは許可されないことがある。その場合は下の欄から手で取れる。
      setCopied(false);
    }
  };

  const load = () => {
    const result = importVariant(text);
    if (!result.ok) {
      setProblems(result.problems);
      return;
    }
    setProblems([]);
    setText('');
    onImported?.(result.variant.id);
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
          value={exportVariant(variant)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn btn-ghost" onClick={copy}>
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>

      {onImported !== undefined && (
        <div className="field">
          <span className="field-label">もらったルールを取り込む</span>
          <textarea
            className="input share-text"
            rows={4}
            value={text}
            placeholder="ここに貼り付け"
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="btn btn-ghost" disabled={text.trim() === ''} onClick={load}>
            取り込む
          </button>
          {problems.length > 0 && (
            <ul className="editor-problems">
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
