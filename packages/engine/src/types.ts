/**
 * Wildcard のドメイン型。
 *
 * 設計上の要点は docs/architecture.md の原則4 ——「ルールは設定データである」。
 * 役の強さや有効なカードはコードに焼き込まず、すべて RuleSet として外から渡す。
 * 標準のテキサスホールデムもまた一つの RuleSet（プリセット）にすぎない。
 */

// ============================================================
// カード
// ============================================================

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

/** 標準の13ランク。弱い順。RuleSet 側でこの順序を差し替えられる。 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

// ============================================================
// ルール定義 — デッキ
// ============================================================

export interface DeckRules {
  /** 使用するスート。減らせば 3スート・2スートのデッキになる。 */
  readonly suits: readonly Suit[];
  /** 使用するランクを弱い順に並べたもの。この配列の index がそのまま強さになる。 */
  readonly ranks: readonly Rank[];
  /**
   * スート間の強さ（強い順）。同ランクのタイブレークに使う。
   * 未指定ならスートに強弱を付けない（引き分けはチョップ）。
   */
  readonly suitRanking?: readonly Suit[];
}

// ============================================================
// ルール定義 — 役
// ============================================================

/**
 * 1枚のカードに課す条件のランク指定。
 *
 * - fixed:    特定のランク（例: 'A'）
 * - variable: 変数。同名の変数は同じランクを指す。offset で相対指定できる。
 *             例) X, X, Y, Y+1, Y+2 = 「2枚のペア + 連続する3枚」
 * - any:      任意
 */
export type RankSpec =
  | { readonly type: 'fixed'; readonly value: Rank }
  | { readonly type: 'variable'; readonly name: string; readonly offset?: number }
  | { readonly type: 'any' };

export interface CardCondition {
  readonly rank: RankSpec;
  /** 許容するスート。空配列は「任意のスート」を意味する。 */
  readonly suits: readonly Suit[];
}

/** 手札全体に課す条件。 */
export type GlobalCondition =
  /** 全枚数が同一スート */
  | { readonly type: 'allSameSuit' }
  /** 全枚数が相異なるスート */
  | { readonly type: 'allDifferentSuit' }
  /** 同一スートが n 枚以上 */
  | { readonly type: 'suitCount'; readonly count: number }
  /** ランクが連続している */
  | { readonly type: 'consecutive' };

export interface HandPattern {
  /** 条件を課すカード。最大5枚。 */
  readonly cards: readonly CardCondition[];
  readonly global: readonly GlobalCondition[];
}

export interface HandRanking {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly pattern: HandPattern;
}

export interface RuleSet {
  readonly id: string;
  readonly name: string;
  readonly deck: DeckRules;
  /** 役を強い順に並べたもの。index 0 が最強。 */
  readonly handRankings: readonly HandRanking[];
}

// ============================================================
// ゲーム状態
// ============================================================

export type Phase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 席番号（0-origin）。 */
  readonly seat: number;
  readonly chips: number;
  /** このベッティングラウンドで既に出している額。 */
  readonly bet: number;
  readonly holeCards: readonly Card[];
  readonly folded: boolean;
  readonly allIn: boolean;
  /** このラウンドで行動済みか。 */
  readonly hasActed: boolean;
  /**
   * ハンド進行中に着席したため、次のハンドまで待機している状態。
   * poker-web-test で問題になった「途中参加者が現ハンドに混ざる」を防ぐ。
   */
  readonly waiting: boolean;
  /** 離席・切断中。自分の番が来たら自動フォールドされる。 */
  readonly away: boolean;
}

export interface GameState {
  readonly phase: Phase;
  readonly players: readonly Player[];
  readonly communityCards: readonly Card[];
  /** 未配の山札。project() で視点に応じて伏せられる。 */
  readonly deck: readonly Card[];
  readonly pot: number;
  /** 現在のラウンドでコールに必要な額。 */
  readonly currentBet: number;
  readonly dealerSeat: number;
  /** 手番のプレイヤーID。誰の手番でもないときは null。 */
  readonly turnPlayerId: string | null;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly ruleSet: RuleSet;
}

// ============================================================
// アクション
// ============================================================

/**
 * エンジンへの入力はすべてこの Action に還元される。
 *
 * 時間切れもまた外から与えられる Action である（原則1 — エンジンは時間を持たない）。
 * シャッフルの乱数も startHand の seed として外から渡す。
 */
export type Action =
  | { readonly type: 'sit'; readonly playerId: string; readonly name: string; readonly seat: number; readonly chips: number }
  | { readonly type: 'leave'; readonly playerId: string }
  | { readonly type: 'setAway'; readonly playerId: string; readonly away: boolean }
  | { readonly type: 'startHand'; readonly seed: number }
  | { readonly type: 'fold'; readonly playerId: string }
  | { readonly type: 'check'; readonly playerId: string }
  | { readonly type: 'call'; readonly playerId: string }
  | { readonly type: 'raise'; readonly playerId: string; readonly to: number }
  | { readonly type: 'timeout'; readonly playerId: string };
