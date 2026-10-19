import { type NonceEntry, commitOf, deriveSeed } from './commit.js';

/**
 * 1ハンドぶんの記録。host も guest も同じものを持ち、あとで突き合わせる。
 */
export interface HandRecord {
  readonly handNo: number;
  /** 配る前に公開されたコミット値。 */
  readonly commit: string;
  /** 使われた nonce。host が配布した一覧。 */
  readonly nonces: readonly NonceEntry[];
  /** 実際に使われた seed のハッシュ。未配なら null。 */
  readonly seedHex: string | null;
  /** 配らずに終わったか（nonce が揃わなかった等）。 */
  readonly aborted: boolean;
  /** 公開された秘密。まだ公開されていなければ null。 */
  readonly secret: string | null;
}

export type VerifyStatus =
  /** コミットと seed の両方が一致した。 */
  | 'verified'
  /** まだ秘密が公開されていない。 */
  | 'unrevealed'
  /** 公開された秘密がコミットと一致しない。差し替えられている。 */
  | 'commit-mismatch'
  /** 秘密と nonce から計算した seed が、使われた seed と一致しない。 */
  | 'seed-mismatch'
  /** 自分の nonce が使われていない。 */
  | 'nonce-missing'
  /**
   * nonce が揃っていたのに配らずに終わっている。
   * host が seed を計算して手を覗いたうえで中断した可能性がある。
   */
  | 'suspicious-abort';

export interface VerifyResult {
  readonly handNo: number;
  readonly status: VerifyStatus;
  readonly detail: string;
}

export interface VerifyOptions {
  /** 自分の playerId。渡すと、自分の nonce が使われたかも確かめる。 */
  readonly selfPlayerId?: string;
  /** そのハンドに参加していたはずの人数。渡すと中断の不自然さを見る。 */
  readonly expectedNonceCount?: number;
}

/** 1ハンドぶんを検証する。 */
export async function verifyHand(
  record: HandRecord,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const { handNo } = record;
  const at = (status: VerifyStatus, detail: string): VerifyResult => ({ handNo, status, detail });

  if (
    options.selfPlayerId !== undefined &&
    record.nonces.length > 0 &&
    !record.nonces.some((entry) => entry.playerId === options.selfPlayerId)
  ) {
    return at('nonce-missing', '自分の乱数が配牌に使われていない');
  }

  if (record.secret === null) {
    return at('unrevealed', 'まだ秘密が公開されていない');
  }

  const commit = await commitOf(record.secret);
  if (commit !== record.commit) {
    return at('commit-mismatch', '公開された秘密が、配る前のコミットと一致しない');
  }

  if (record.aborted) {
    const complete =
      options.expectedNonceCount !== undefined &&
      record.nonces.length >= options.expectedNonceCount;
    return complete
      ? at('suspicious-abort', '乱数が揃っていたのに配られずに終わっている')
      : at('verified', '配られずに終わった（乱数が揃わなかった）');
  }

  if (record.seedHex === null) {
    return at('seed-mismatch', '配られたことになっているが seed が記録されていない');
  }

  const derived = await deriveSeed(record.secret, record.nonces);
  if (derived.seedHex !== record.seedHex) {
    return at('seed-mismatch', '秘密と乱数から計算した seed が、使われた seed と違う');
  }

  return at('verified', '配牌は記録どおり');
}

export async function verifyAll(
  records: readonly HandRecord[],
  options: VerifyOptions = {},
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = [];
  for (const record of records) results.push(await verifyHand(record, options));
  return results;
}

export interface VerifySummary {
  readonly total: number;
  readonly verified: number;
  readonly unrevealed: number;
  /** 明確におかしいもの。1件でもあれば配牌を疑う理由になる。 */
  readonly failed: number;
  readonly byStatus: Readonly<Record<VerifyStatus, number>>;
}

export function summarize(results: readonly VerifyResult[]): VerifySummary {
  const byStatus: Record<VerifyStatus, number> = {
    verified: 0,
    unrevealed: 0,
    'commit-mismatch': 0,
    'seed-mismatch': 0,
    'nonce-missing': 0,
    'suspicious-abort': 0,
  };
  for (const result of results) byStatus[result.status]++;

  return {
    total: results.length,
    verified: byStatus.verified,
    unrevealed: byStatus.unrevealed,
    failed:
      byStatus['commit-mismatch'] +
      byStatus['seed-mismatch'] +
      byStatus['nonce-missing'] +
      byStatus['suspicious-abort'],
    byStatus,
  };
}
