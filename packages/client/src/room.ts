/**
 * ルームコード。
 *
 * 口頭で伝えることを想定して、見間違えやすい文字（O/0, I/1/L）を使わない。
 * コード自体はトラッカーに出ない（SHA-1 したものを info_hash に使う）。
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function createRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

/**
 * 入力されたコードを正規化する。
 *
 * やるのは大文字化と、区切り文字（空白・ハイフン等）の除去だけ。
 * 紛らわしい文字をそれらしい文字へ寄せる処理は入れない。
 * O を Q に、I を J に、といった推測は当たる保証がなく、
 * 正しく入力されたコードまで黙って書き換えてしまうため。
 * 使われていない文字が入っていれば isValidRoomCode が弾くので、
 * 打ち直してもらうほうが確実。
 */
export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** 使われていない文字を指摘する。入力中の案内に使う。 */
export function invalidRoomCodeChars(code: string): string[] {
  return [...new Set([...code])].filter((c) => !ALPHABET.includes(c));
}
