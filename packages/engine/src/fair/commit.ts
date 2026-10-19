/**
 * 配牌の公正さを後から検証できるようにする仕組み。
 *
 * 塞ぎたい不正は2つある。
 *
 *   配り直し … 配って自分の手を見て、気に入らなければ配り直す
 *   seed漁り … 事前に何千通りも seed を試し、自分に良い手が来るものを選ぶ
 *
 * ハッシュのコミットだけでは **配り直ししか塞げない**。配る前に好きなだけ
 * 探索できてしまうからである。両方塞ぐには全員が乱数を持ち寄る必要がある。
 *
 *   1. host が秘密の乱数 R を作り、commit = SHA-256(R) を全員に配る
 *      → この時点で R は固定される（ハッシュから R は逆算できない）
 *   2. 各 guest が自分の乱数 Nᵢ を host に送る
 *      → host は R を固定した後に Nᵢ を受け取る。Nᵢ を知らずに R を決めている
 *   3. host が seed = SHA-256(R ‖ N₁ ‖ N₂ ‖ …) を計算して配る
 *      → R だけでも Nᵢ だけでも seed を決められない。host は結果を狙えない
 *   4. セッション終了後に host が R を公開する
 *   5. 各自が手元で commit と seed を計算し直して突き合わせる
 *
 * これは **証明ではなく、後から検証できる記録を残すこと** である。
 * host が「見てしまう」こと自体は塞げない（メンタルポーカーかサーバーが要る）。
 * 塞げるのは、見た結果に合わせて配り直す・seed を選ぶ、という操作のほう。
 */

export interface NonceEntry {
  readonly playerId: string;
  readonly nonce: string;
}

const HEX = '0123456789abcdef';

/** 乱数の文字列。host の秘密にも guest の nonce にも使う。 */
export function randomHex(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = '';
  for (const byte of buffer) out += HEX[byte >> 4]! + HEX[byte & 15]!;
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** 秘密から公開するコミット値。 */
export const commitOf = (secret: string): Promise<string> => sha256Hex(secret);

/**
 * nonce を一意な文字列に畳む。
 *
 * 並び順で結果が変わってしまうと、host が並べ替えで seed を選べてしまう。
 * playerId で並べ替えて順序を固定する。
 */
export function canonicalNonces(nonces: readonly NonceEntry[]): string {
  return [...nonces]
    .map((entry) => `${entry.playerId}:${entry.nonce}`)
    .sort()
    .join('|');
}

export interface DerivedSeed {
  /** 検証用の全文ハッシュ。 */
  readonly seedHex: string;
  /** エンジンに渡す 32bit の種。seedHex の先頭から取る。 */
  readonly seed: number;
}

/** 秘密と全員の nonce から seed を導く。誰が計算しても同じ結果になる。 */
export async function deriveSeed(
  secret: string,
  nonces: readonly NonceEntry[],
): Promise<DerivedSeed> {
  const seedHex = await sha256Hex(`${secret}|${canonicalNonces(nonces)}`);
  return { seedHex, seed: Number.parseInt(seedHex.slice(0, 8), 16) >>> 0 };
}
