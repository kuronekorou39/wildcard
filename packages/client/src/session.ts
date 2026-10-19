import { randomId } from './net/peerLink.js';

/**
 * この端末の識別子。
 *
 * 再接続したとき同じ席に戻るために使う。localStorage に残すので、
 * リロードしてもタブを閉じても同じ人として扱われる。
 *
 * ルームコードとこの値を知っていれば切断中の人になりすませてしまうので、
 * 他人に見せる場所には出さないこと（UI には出していない）。
 */
const KEY = 'wildcard.sessionId';

export function sessionId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null && stored.length >= 8) return stored;
    const created = randomId(24);
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    // プライベートブラウジング等。毎回変わるが、同じタブの間は使える。
    return randomId(24);
  }
}
