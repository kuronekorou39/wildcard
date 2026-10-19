import { describe, expect, it } from 'vitest';
import {
  type NonceEntry,
  canonicalNonces,
  commitOf,
  deriveSeed,
  randomHex,
  sha256Hex,
} from '../src/fair/commit.js';
import { type HandRecord, summarize, verifyAll, verifyHand } from '../src/fair/verify.js';
import { buildDeck, shuffle } from '../src/deck.js';
import { STANDARD_RULESET } from '../src/rules/presets.js';

const nonces: NonceEntry[] = [
  { playerId: 'b', nonce: 'bbbb' },
  { playerId: 'a', nonce: 'aaaa' },
];

/** 検証を通る正しい記録を作る。 */
async function goodRecord(handNo = 1): Promise<HandRecord> {
  const secret = randomHex();
  const commit = await commitOf(secret);
  const { seedHex } = await deriveSeed(secret, nonces);
  return { handNo, commit, nonces, seedHex, aborted: false, secret };
}

describe('コミットと seed の導出', () => {
  it('コミットから秘密は分からないが、照合はできる', async () => {
    const secret = randomHex();
    const commit = await commitOf(secret);
    expect(commit).toHaveLength(64);
    expect(commit).not.toBe(secret);
    expect(await commitOf(secret)).toBe(commit);
    expect(await commitOf(randomHex())).not.toBe(commit);
  });

  it('nonce の並び順で seed が変わらない', async () => {
    // 並べ替えで結果が変われば、host が並び順を選んで seed を狙えてしまう。
    const forward = await deriveSeed('secret', nonces);
    const reversed = await deriveSeed('secret', [...nonces].reverse());
    expect(forward.seedHex).toBe(reversed.seedHex);
    expect(canonicalNonces(nonces)).toBe(canonicalNonces([...nonces].reverse()));
  });

  it('秘密が変われば seed も変わる', async () => {
    const a = await deriveSeed('secret-a', nonces);
    const b = await deriveSeed('secret-b', nonces);
    expect(a.seedHex).not.toBe(b.seedHex);
  });

  it('nonce がひとつ変われば seed も変わる', async () => {
    const a = await deriveSeed('secret', nonces);
    const b = await deriveSeed('secret', [
      { playerId: 'a', nonce: 'aaaa' },
      { playerId: 'b', nonce: 'cccc' },
    ]);
    expect(a.seedHex).not.toBe(b.seedHex);
  });

  it('誰が計算しても同じ seed になる', async () => {
    const secret = randomHex();
    const mine = await deriveSeed(secret, nonces);
    const theirs = await deriveSeed(secret, [...nonces].reverse());
    expect(mine).toEqual(theirs);
  });

  it('乱数は毎回違う', () => {
    const values = new Set(Array.from({ length: 200 }, () => randomHex()));
    expect(values.size).toBe(200);
  });

  it('同じ seed からは同じ配牌が再現される', async () => {
    // 検証が成立する根拠。エンジンが乱数を持たず seed を外から受けているから、
    // 公開された秘密から配牌を丸ごと再現して突き合わせられる。
    const { seed } = await deriveSeed('secret', nonces);
    const deck = buildDeck(STANDARD_RULESET.deck);
    expect(shuffle(deck, seed)).toEqual(shuffle(deck, seed));
  });
});

describe('検証', () => {
  it('正しい記録は検証を通る', async () => {
    const result = await verifyHand(await goodRecord());
    expect(result.status).toBe('verified');
  });

  it('秘密が未公開なら未検証として扱う', async () => {
    const record = { ...(await goodRecord()), secret: null };
    expect((await verifyHand(record)).status).toBe('unrevealed');
  });

  it('秘密を差し替えるとコミット不一致で落ちる', async () => {
    const record = { ...(await goodRecord()), secret: randomHex() };
    expect((await verifyHand(record)).status).toBe('commit-mismatch');
  });

  it('違う seed で配っていると seed 不一致で落ちる', async () => {
    const record = { ...(await goodRecord()), seedHex: await sha256Hex('でっちあげ') };
    expect((await verifyHand(record)).status).toBe('seed-mismatch');
  });

  it('使われた nonce を書き換えると落ちる', async () => {
    const record = {
      ...(await goodRecord()),
      nonces: [
        { playerId: 'a', nonce: 'aaaa' },
        { playerId: 'b', nonce: 'すり替え' },
      ],
    };
    expect((await verifyHand(record)).status).toBe('seed-mismatch');
  });

  it('自分の乱数が使われていなければ気づける', async () => {
    const record = await goodRecord();
    const result = await verifyHand(record, { selfPlayerId: 'c' });
    expect(result.status).toBe('nonce-missing');
  });

  it('自分の乱数が使われていれば通る', async () => {
    const record = await goodRecord();
    expect((await verifyHand(record, { selfPlayerId: 'a' })).status).toBe('verified');
  });

  it('乱数が揃わずに中断したハンドは正常として扱う', async () => {
    const secret = randomHex();
    const record: HandRecord = {
      handNo: 1,
      commit: await commitOf(secret),
      nonces: [{ playerId: 'a', nonce: 'aaaa' }],
      seedHex: null,
      aborted: true,
      secret,
    };
    const result = await verifyHand(record, { expectedNonceCount: 2 });
    expect(result.status).toBe('verified');
  });

  it('乱数が揃っていたのに中断していれば疑わしいと出る', async () => {
    // host が seed を計算して手を覗いたうえで中断した可能性がある。
    const secret = randomHex();
    const record: HandRecord = {
      handNo: 1,
      commit: await commitOf(secret),
      nonces,
      seedHex: null,
      aborted: true,
      secret,
    };
    const result = await verifyHand(record, { expectedNonceCount: 2 });
    expect(result.status).toBe('suspicious-abort');
  });
});

describe('まとめ', () => {
  it('件数を数えられる', async () => {
    const good = await goodRecord(1);
    const records: HandRecord[] = [
      good,
      { ...good, handNo: 2 },
      { ...good, handNo: 3, secret: null },
      { ...good, handNo: 4, secret: randomHex() },
    ];
    const summary = summarize(await verifyAll(records));

    expect(summary.total).toBe(4);
    expect(summary.verified).toBe(2);
    expect(summary.unrevealed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.byStatus['commit-mismatch']).toBe(1);
  });

  it('空の記録でも数えられる', () => {
    const summary = summarize([]);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
  });
});

describe('host が配り直しや seed 漁りをできないこと', () => {
  it('コミットした後に秘密を変えると必ずばれる', async () => {
    // 配った後に「実は別の秘密だった」と言い張れない。
    const honest = randomHex();
    const commit = await commitOf(honest);
    const cheated = randomHex();
    const { seedHex } = await deriveSeed(cheated, nonces);

    const record: HandRecord = {
      handNo: 1,
      commit,
      nonces,
      seedHex,
      aborted: false,
      secret: cheated,
    };
    expect((await verifyHand(record)).status).toBe('commit-mismatch');
  });

  it('秘密を固定した時点では seed を予測できない', async () => {
    // guest の乱数が後から入るので、同じ秘密でも結果はばらける。
    const secret = randomHex();
    const seeds = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { seedHex } = await deriveSeed(secret, [
        { playerId: 'a', nonce: randomHex() },
        { playerId: 'b', nonce: randomHex() },
      ]);
      seeds.add(seedHex);
    }
    expect(seeds.size).toBe(50);
  });
});
