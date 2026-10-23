import type { Action, VisibleState } from '@wildcard/engine';
import type { TableRuntimeSnapshot } from './tableRuntime.js';

/**
 * 通信の状態。ローカル実装では常に 'local'。
 * UI はこれを見て「接続中」「切断」を出す。
 */
export type ConnectionStatus =
  | 'local'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'rejected'
  | 'closed';

export interface TableSnapshot {
  readonly pending?: boolean;
  readonly actionRevision?: number;
  readonly runtime?: TableRuntimeSnapshot;
  /** この視点から見える状態。見えないカードはエンジン側で伏せられている。 */
  readonly state: VisibleState;
  /** 視点の持ち主。観戦なら null。 */
  readonly viewerId: string | null;
  readonly status: ConnectionStatus;
  /** 拒否理由や切断の説明。無ければ null。 */
  readonly note: string | null;
}

/**
 * UI とエンジンの間の唯一の接点（docs/architecture.md の原則3）。
 *
 * UI はエンジンを直接叩かず、必ずこの interface を通す。
 *
 * - LocalTransport  … 同じタブの中でエンジンを回す。サーバー不要（段階0）
 * - HostTransport / GuestTransport … 一時的な P2P 卓
 * - ServerTransport … WebSocket で保存されるサーバー側の卓に接続する
 *
 * 同じ卓UIを再利用し、認証・保存・復旧は通信とサーバー側で扱う。
 */
export interface Transport {
  snapshot(): TableSnapshot;
  /** 状態が変わるたびに呼ばれる。返り値を呼ぶと購読をやめる。 */
  subscribe(listener: (snapshot: TableSnapshot) => void): () => void;
  dispatch(action: Action): void;
}
