import { webcrypto } from 'node:crypto';

/**
 * Node 18 のテスト環境には globalThis.crypto が無い。
 * ブラウザでは必ずあるものなので、ここで補ってテストを実行可能にする。
 */
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
