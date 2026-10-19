import type { Action, VisibleState } from '@wildcard/engine';

export interface TableSnapshot {
  /** この視点から見える状態。見えないカードはエンジン側で伏せられている。 */
  readonly state: VisibleState;
  /** 視点の持ち主。観戦なら null。 */
  readonly viewerId: string | null;
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
