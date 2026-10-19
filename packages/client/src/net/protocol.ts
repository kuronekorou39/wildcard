import type { Action, VisibleState } from '@wildcard/engine';

/**
 * 卓のネットワークプロトコル。
 *
 * 形は host 権威型。host が唯一エンジンを回し、guest は「やりたいこと」を
 * 送るだけで、返ってくるのは **その人向けに伏せられた状態** である。
 *
 * hayabuzz は STATE を全員に同じ内容でブロードキャストしていたが、ポーカーでは
 * 人によって見えるものが違う。そのため STATE は必ず宛先を指定して送り、
 * 中身は host が project(state, その人) した結果にする。
 */

/** スキーマを変えたら上げる。版が違う相手とは繋がない。 */
export const PROTO_VERSION = 1;

export const MSG = {
  // guest → host
  /** 参加・再参加の要求。 */
  HELLO: 'hello',
  /** ゲームのアクション（フォールド、着席など）。 */
  ACTION: 'action',

  // host → guest
  /** 参加受理。 */
  WELCOME: 'welcome',
  /** 参加拒否。 */
  REJECTED: 'rejected',
  /** その人向けに伏せた状態のスナップショット。 */
  STATE: 'state',
  /** host が部屋を閉じた。単なる切断と区別して、戻りを待たせない。 */
  CLOSED: 'closed',
} as const;

export interface HelloMessage {
  readonly type: typeof MSG.HELLO;
  readonly proto: number;
  /** 端末ごとに固定の識別子。再接続のとき同じ席に戻るために使う。 */
  readonly sessionId: string;
  readonly name: string;
}

export interface ActionMessage {
  readonly type: typeof MSG.ACTION;
  readonly action: Action;
}

export interface WelcomeMessage {
  readonly type: typeof MSG.WELCOME;
  readonly playerId: string;
  /** 既存の席に戻ったか（新規参加なら false）。 */
  readonly resumed: boolean;
  /** host 自身が席に着いているか。着いていなければ中立のディーラー。 */
  readonly hostIsPlaying: boolean;
}

export interface RejectedMessage {
  readonly type: typeof MSG.REJECTED;
  readonly reason: string;
}

export interface StateMessage {
  readonly type: typeof MSG.STATE;
  readonly state: VisibleState;
}

export interface ClosedMessage {
  readonly type: typeof MSG.CLOSED;
}

export type GuestMessage = HelloMessage | ActionMessage;
export type HostMessage = WelcomeMessage | RejectedMessage | StateMessage | ClosedMessage;

// ============================================================
// 受信の検証
// ============================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const NAME_MAX_LEN = 12;
export const SESSION_ID_MAX_LEN = 40;

/**
 * guest から届いたメッセージを検証する。
 *
 * **ここを通った時点ではまだ「正しい相手からの正しい要求」ではない。**
 * 形が合っているだけで、そのアクションをその人が出してよいかは
 * host 側の認可（authorizeAction）で別途確かめる。
 */
export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isRecord(raw)) return null;

  switch (raw['type']) {
    case MSG.HELLO:
      if (!isFiniteNumber(raw['proto'])) return null;
      if (!isString(raw['sessionId'], SESSION_ID_MAX_LEN)) return null;
      if (!isString(raw['name'], NAME_MAX_LEN)) return null;
      return {
        type: MSG.HELLO,
        proto: raw['proto'],
        sessionId: raw['sessionId'],
        name: raw['name'],
      };

    case MSG.ACTION: {
      const action = parseAction(raw['action']);
      return action === null ? null : { type: MSG.ACTION, action };
    }

    default:
      return null;
  }
}

/** host から届いたメッセージを検証する。 */
export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isRecord(raw)) return null;

  switch (raw['type']) {
    case MSG.WELCOME:
      if (!isString(raw['playerId'], SESSION_ID_MAX_LEN)) return null;
      if (typeof raw['resumed'] !== 'boolean') return null;
      if (typeof raw['hostIsPlaying'] !== 'boolean') return null;
      return {
        type: MSG.WELCOME,
        playerId: raw['playerId'],
        resumed: raw['resumed'],
        hostIsPlaying: raw['hostIsPlaying'],
      };

    case MSG.REJECTED:
      if (!isString(raw['reason'], 200)) return null;
      return { type: MSG.REJECTED, reason: raw['reason'] };

    case MSG.STATE: {
      // host は権威なので中身は信じる。嘘をつける相手を深く検証しても意味がない
      // （嘘をつかせないためには host を持たない構成＝サーバーか暗号が要る）。
      // ここで見るのは、UI が落ちない最低限の形だけ。
      const state = raw['state'];
      if (!isRecord(state)) return null;
      if (!Array.isArray(state['players'])) return null;
      if (typeof state['phase'] !== 'string') return null;
      return { type: MSG.STATE, state: state as unknown as VisibleState };
    }

    case MSG.CLOSED:
      return { type: MSG.CLOSED };

    default:
      return null;
  }
}

/** Action の形だけを確かめる。妥当性はエンジンの validate が見る。 */
function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  const type = raw['type'];

  switch (type) {
    case 'sit':
      if (!isString(raw['playerId'], SESSION_ID_MAX_LEN)) return null;
      if (!isString(raw['name'], NAME_MAX_LEN)) return null;
      if (!isFiniteNumber(raw['seat']) || !isFiniteNumber(raw['chips'])) return null;
      return {
        type: 'sit',
        playerId: raw['playerId'],
        name: raw['name'],
        seat: raw['seat'],
        chips: raw['chips'],
      };

    case 'setAway':
      if (!isString(raw['playerId'], SESSION_ID_MAX_LEN)) return null;
      if (typeof raw['away'] !== 'boolean') return null;
      return { type: 'setAway', playerId: raw['playerId'], away: raw['away'] };

    case 'raise':
      if (!isString(raw['playerId'], SESSION_ID_MAX_LEN)) return null;
      if (!isFiniteNumber(raw['to'])) return null;
      return { type: 'raise', playerId: raw['playerId'], to: raw['to'] };

    case 'leave':
    case 'fold':
    case 'check':
    case 'call':
    case 'timeout':
      if (!isString(raw['playerId'], SESSION_ID_MAX_LEN)) return null;
      return { type, playerId: raw['playerId'] };

    // startHand は host だけが出す。guest からは受け付けない。
    default:
      return null;
  }
}

/**
 * そのアクションを、その席の持ち主が出したのかを確かめる。
 *
 * **プロトコルの検証とは別物で、こちらが本体。** 形が正しいだけのメッセージは
 * 「他人の名前で降りる」「他人を離席させる」ことができてしまう。
 * 席の持ち主（peer と playerId の対応）は host だけが知っていて、
 * guest が名乗った内容は一切信用しない。
 */
export function authorizeAction(action: Action, ownerPlayerId: string): boolean {
  if (action.type === 'startHand') return false; // host 専用
  return action.playerId === ownerPlayerId;
}
