import { useEffect, useState } from 'react';
import {
  type HandRecord,
  type VerifyResult,
  type VerifyStatus,
  summarize,
  verifyAll,
} from '@wildcard/engine';

interface FairnessPanelProps {
  readonly records: readonly HandRecord[];
  readonly selfPlayerId: string | null;
  /** そのハンドに居たはずの人数。中断の不自然さを見るのに使う。 */
  readonly expectedNonceCount: number;
  /** host だけが渡す。秘密を公開する操作。 */
  readonly onReveal: (() => void) | null;
  readonly revealed: boolean;
}

const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: '検証OK',
  unrevealed: '未公開',
  'commit-mismatch': 'コミット不一致',
  'seed-mismatch': 'seed不一致',
  'nonce-missing': '自分の乱数が未使用',
  'suspicious-abort': '不自然な中断',
};

/**
 * 配牌の検証。
 *
 * 不正を防ぐ仕組みではなく、**後から検証できる記録を見せる**もの。
 * host が「見てしまう」こと自体は塞げないが、配り直しと seed 漁りは
 * ここに出る。詳しい手順は engine の fair/commit.ts にある。
 */
export function FairnessPanel({
  records,
  selfPlayerId,
  expectedNonceCount,
  onReveal,
  revealed,
}: FairnessPanelProps) {
  const [results, setResults] = useState<readonly VerifyResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    void verifyAll(records, {
      ...(selfPlayerId !== null ? { selfPlayerId } : {}),
      expectedNonceCount,
    }).then((verified) => {
      if (!cancelled) setResults(verified);
    });
    return () => {
      cancelled = true;
    };
  }, [records, selfPlayerId, expectedNonceCount]);

  const summary = summarize(results);

  return (
    <details className="fair-panel">
      <summary className="rule-sheet-summary">
        配牌の検証
        {summary.failed > 0 && <span className="fair-flag"> 要確認 {summary.failed}</span>}
      </summary>

      <div className="rule-sheet-body">
        <p className="fair-note">
          配る前に host が秘密をコミットし、全員の乱数を混ぜて配牌を決めています。
          セッション終了後に秘密が公開されると、配り直しや seed の選び直しが
          なかったことを各自の端末で確かめられます。
          <strong> host が手札を見てしまうこと自体は、この仕組みでは防げません。</strong>
        </p>

        {records.length === 0 ? (
          <p className="fair-note">まだ記録がありません。</p>
        ) : (
          <>
            <ul className="fair-summary">
              <li>記録したハンド: {summary.total}</li>
              <li>検証OK: {summary.verified}</li>
              {summary.unrevealed > 0 && <li>未公開: {summary.unrevealed}</li>}
              {summary.failed > 0 && (
                <li className="fair-failed">要確認: {summary.failed}</li>
              )}
            </ul>

            <ol className="fair-list">
              {results.map((result) => (
                <li key={result.handNo} className={`fair-row fair-${result.status}`}>
                  <span className="fair-hand">#{result.handNo}</span>
                  <span className="fair-status">{STATUS_LABEL[result.status]}</span>
                  <span className="fair-detail">{result.detail}</span>
                </li>
              ))}
            </ol>
          </>
        )}

        {onReveal !== null && (
          <button
            type="button"
            className="btn btn-muted btn-small"
            onClick={onReveal}
            disabled={revealed || records.length === 0}
          >
            {revealed ? '公開済み' : '秘密を公開して検証してもらう'}
          </button>
        )}

        {onReveal !== null && !revealed && (
          <p className="fair-note">
            公開すると、そのセッションの全ハンドの配牌が再現できるようになります
            （降りた手も含めて）。対局が終わってから押してください。
          </p>
        )}
      </div>
    </details>
  );
}
