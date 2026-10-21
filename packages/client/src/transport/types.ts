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
 * UI はエンジンを直接叩かず、必ずこの interface を通す。実装は2つある。
 *
 * - LocalTransport  … 同じタブの中でエンジンを回す。サーバー不要（段階0）
 * - RemoteTransport … WebSocket でサーバーのエンジンを叩く（段階1以降）
 *
 * UI から見てこの2つは区別できない。だからオンライン対応は差し替えで済み、
 * 書き直しにならない。旧3プロジェクトがこれをやらなかったために、
 * 片方のUIと片方のエンジンを組み替えることができなかった。
 */
export interface Transport {
  snapshot(): TableSnapshot;
  /** 状態が変わるたびに呼ばれる。返り値を呼ぶと購読をやめる。 */
  subscribe(listener: (snapshot: TableSnapshot) => void): () => void;
  dispatch(action: Action): void;
}
