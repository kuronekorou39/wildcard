import {
  type Action,
  type CreateGameOptions,
  type GameState,
  createGame,
  project,
  reduce,
} from '@wildcard/engine';
import type { TableSnapshot, Transport } from './types.js';

/**
 * 視点の決め方。ソロとホットシートの違いはここだけに現れる。
 *
 * - fixed      … 常に同じ人の視点。ソロ（CPU相手）
 * - followTurn … 手番の人の視点。ホットシート（1台を回す）
 */
export type ViewerPolicy =
  | { readonly kind: 'fixed'; readonly playerId: string }
  | { readonly kind: 'followTurn' };

export interface LocalTransportOptions extends CreateGameOptions {
  readonly viewer: ViewerPolicy;
  /** 開始時に流しておくアクション（着席など）。 */
  readonly setup?: readonly Action[];
}

/**
 * 同じタブの中でエンジンを回す Transport。
 *
 * サーバーが無くても成立するのは、秘匿がエンジンの責務になっているから（原則2）。
 * UI には project() を通した結果しか渡らないので、ホールカードは画面に出ない。
 */
export class LocalTransport implements Transport {
  private state: GameState;
  /**
   * snapshot() は同じ状態に対して必ず同じオブジェクトを返さなければならない。
   * React の useSyncExternalStore は Object.is で変化を見るため、毎回新しい
   * オブジェクトを作ると無限に再レンダリングし続ける。
   */
  private cached: TableSnapshot;
  private readonly policy: ViewerPolicy;
  private readonly listeners = new Set<(snapshot: TableSnapshot) => void>();

  constructor(options: LocalTransportOptions) {
    const { viewer, setup, ...gameOptions } = options;
    this.policy = viewer;
    this.state = (setup ?? []).reduce(reduce, createGame(gameOptions));
    this.cached = this.compute();
  }

  snapshot(): TableSnapshot {
    return this.cached;
  }

  subscribe(listener: (snapshot: TableSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispatch(action: Action): void {
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.cached = this.compute();
    this.emit();
  }

  /** エンジンの生の状態。CPU の思考など、伏せる必要のない処理のためだけに使う。 */
  rawState(): GameState {
    return this.state;
  }

  private viewerId(): string | null {
    if (this.policy.kind === 'fixed') return this.policy.playerId;
    return this.state.turnPlayerId;
  }

  private compute(): TableSnapshot {
    const viewerId = this.viewerId();
    return { state: project(this.state, viewerId), viewerId };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.cached);
  }
}
