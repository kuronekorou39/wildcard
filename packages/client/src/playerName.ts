/** 卓に出す自分の名前。モードを問わず1つで、このブラウザに保存する。 */
const KEY = 'wildcard.playerName';
export const PLAYER_NAME_MAX = 24;

export function loadPlayerName(): string {
  try { return (localStorage.getItem(KEY) ?? '').slice(0, PLAYER_NAME_MAX); } catch { return ''; }
}

export function savePlayerName(name: string): void {
  try { localStorage.setItem(KEY, name.slice(0, PLAYER_NAME_MAX)); } catch { /* 保存できなくても入力中は使える */ }
}
