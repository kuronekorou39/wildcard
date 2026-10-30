import {
  type Action,
  type CreateGameOptions,
  type GameState,
  createGame,
  project,
  reduce,
} from '@wildcard/engine';
import type { TableSnapshot, Transport } from './types.js';
import { isDecision, TableRuntime } from './tableRuntime.js';

/**
 * 視点の決め方。
 *
 * - fixed      … 常に同じ人の視点。ソロ（CPU相手）
 * - followTurn … 手番の人の視点。進行・秘匿の内部検証用。
 */
export type ViewerPolicy =
  | { readonly kind: 'fixed'; readonly playerId: string }
  | { readonly kind: 'followTurn' };

export interface LocalTransportOptions extends CreateGameOptions {
  readonly paced?: boolean;
  readonly autoNextHandMs?: number;
  readonly turnTimeMs?: number;
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
  private readonly runtime: TableRuntime;
  private readonly paced: boolean;

  constructor(options: LocalTransportOptions) {
    const { viewer, setup, turnTimeMs, paced = false, autoNextHandMs, ...gameOptions } = options;
    this.policy = viewer;
    this.paced = paced;
    this.runtime = new TableRuntime(playerId => this.dispatch({ type: 'timeout', playerId }), turnTimeMs, viewer.kind === 'followTurn', {
      paced, ...(autoNextHandMs !== undefined ? { nextHandDelayMs: autoNextHandMs, onNextHand: () => {
        this.dispatch({ type: 'startHand', seed: (Date.now() ^ (this.runtime.snapshot().handId * 2654435761)) >>> 0 });
      } } : {}),
    });
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
    if (this.paced && (isDecision(action) || action.type === 'startHand') && Date.now() < this.runtime.snapshot().readyAt) return;
    const clock = this.runtime.snapshot().clock;
    if (isDecision(action) && action.type !== 'timeout' && clock?.deadline != null && Date.now() >= clock.deadline) {
      this.dispatch({ type: 'timeout', playerId: clock.playerId });
      return;
    }
    const next = reduce(this.state, action);
    if (next === this.state) return;
    this.runtime.advance(this.state, next, action);
    this.state = next;
    this.cached = this.compute();
    this.emit();
  }

  /** エンジンの生の状態。CPU の思考など、伏せる必要のない処理のためだけに使う。 */
  rawState(): GameState {
    return this.state;
  }

  resume() { this.runtime.resume(); }
  dispose() { this.runtime.dispose(); }
  cancelNextHand() { this.runtime.cancelNextHand(); this.cached = this.compute(); this.emit(); }
  revealTurn() {
    if (this.runtime.revealTurn()) { this.cached = this.compute(); this.emit(); }
  }

  private viewerId(): string | null {
    if (this.policy.kind === 'fixed') return this.policy.playerId;
    return this.state.turnPlayerId;
  }

  private compute(): TableSnapshot {
    const viewerId = this.viewerId();
    return { state: project(this.state, viewerId), viewerId, status: 'local', note: null, runtime: this.runtime.snapshot() };
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.cached);
  }
}
