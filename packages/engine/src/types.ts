/**
 * Wildcard のドメイン型。
 *
 * 要点は docs/variants.md ——「エンジンのコードに『ホールデムならこう』という
 * 分岐を一切書かない」。ホールデムもオマハもユーザーが作った変種も、すべて
 * 同じ Variant というデータであり、エンジンはそれを読んで動くだけである。
 */

// ============================================================
// カード
// ============================================================

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type Suit = (typeof SUITS)[number];

/** 標準の13ランク。弱い順。Variant 側でこの順序を差し替えられる。 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
  /**
   * ジョーカーの通し番号。通常のカードでは undefined。
   *
   * **ジョーカーの rank と suit には意味がない。** 置き換え前の仮の値なので、
   * 役の判定に使ってはいけない（評価の前にワイルドの規則で別のカードへ
   * 置き換える）。同一性の比較には必ず cardKey() を使うこと。
   */
  readonly joker?: number;
}

// ============================================================
// 軸1: デッキ — 何で遊ぶか
// ============================================================

/** 特定のカードの枚数を名指しで決める。 */
export interface CardCount {
  readonly rank: Rank;
  readonly suit: Suit;
  /** 枚数。0 にするとそのカードだけデッキから抜ける。 */
  readonly count: number;
}

export interface DeckRules {
  /**
   * 直積の素になるスート。ここから外せばそのスートが丸ごと消える
   * （「クラブだけ抜く」はこれで足りる）。
   */
  readonly suits: readonly Suit[];
  /**
   * 使用するランクを **弱い順** に並べたもの。この配列の index がそのまま強さ。
   *
   * 並び順がストレートの意味も決める点に注意。10 を A の上に移すと
   * 「TT が AA より強い」が成立する代わりに、9-10-J-Q-K は連続でなくなる。
   */
  readonly ranks: readonly Rank[];
  /**
   * スート間の強さ（強い順）。同ランクのタイブレークに使う。
   * 未指定ならスートに強弱を付けない（引き分けはチョップ）。
   */
  readonly suitRanking?: readonly Suit[];
  /** 直積で作る各カードの枚数。2 にすると全部2枚ずつ。既定1。 */
  readonly copies?: number;
  /** ジョーカーの枚数。既定0。何に化けるかは ranking.wilds が決める。 */
  readonly jokers?: number;
  /**
   * カード単位の上書き。直積の結果より優先される。
   *
   * 「スペードのAを10枚」「ハートのKだけ抜く」といった偏ったデッキを作るための口。
   * suits に無いスートを足すこともできる（例: スペードのみ + ハートのAを1枚）。
   */
  readonly overrides?: readonly CardCount[];
}

// ============================================================
// 軸2: 構造 — どう配って、どう組むか
// ============================================================

export interface Street {
  readonly name: string;
  /** 場に開く枚数。0 でもよい（カードを開かないベッティングラウンド）。 */
  readonly cards: number;
  /**
   * 開く前に山札から落とす枚数（バーンカード）。既定0。
   *
   * 結果の確率分布は変わらないが、必要なデッキ枚数は変わる。
   * ルールとして指定できないと「52枚きっかりで回るはず」が狂う。
   */
  readonly burn?: number;
}

/** 使用枚数の範囲。 */
export interface UsageRange {
  readonly min: number;
  readonly max: number;
}

export interface HandStructure {
  /** 各プレイヤーに配る手札の枚数。ホールデム2、オマハ4。 */
  readonly holeCards: number;
  /** 場に開く段階。ホールデムは 3,1,1。空ならドロー系（場なし）。 */
  readonly streets: readonly Street[];
  /** 役を作る枚数。通常5。 */
  readonly handSize: number;
  /** 手札から使う枚数。省略すると「何枚使ってもよい」。オマハは {2,2}。 */
  readonly holeUsage?: UsageRange;
  /** 場から使う枚数。省略すると「何枚使ってもよい」。オマハは {3,3}。 */
  readonly boardUsage?: UsageRange;
}

// ============================================================
// 軸3: ベッティング — どう賭けるか
// ============================================================

export type LimitKind = 'no-limit' | 'pot-limit' | 'fixed-limit';

export interface StreetCap {
  /** PREFLOP(-1) がプリフロップ、0 以降は streets の index。 */
  readonly street: number;
  /**
   * そのストリートでのオールインを禁じる（最低1枚は残す）。
   *
   * **レイズだけを縛る。** コールは縛らない——縛ると、相手のベットに
   * 応じられない人が出て勝負が進まなくなる。
   */
  readonly noAllIn?: boolean;
  /** そのストリートで1人が出せる合計額の上限。 */
  readonly maxTotal?: number;
}

/**
 * 賭け方の制度。
 *
 * **掛け金（SB/BB/アンティ）はここに入れない。** 同じバリアントのまま
 * 額だけ変えられる必要があるため、額は GameState 側に置く。
 */
export interface BettingRules {
  readonly limit: LimitKind;
  /**
   * ストラドルの重ね回数。省略すると不可。
   *
   * ストラドルは BB の左隣が自主的に出す「見ずに倍の賭け金」。
   * 出すと**その人が最後に行動する**ので、順番そのものが変わる。
   */
  readonly straddle?: { readonly max: number };
  readonly streetCaps?: readonly StreetCap[];
  /**
   * 1ラウンドのレイズ回数の上限。省略すると無制限。
   * フィックスリミットでは4回（ベット＋レイズ3回）が普通。
   */
  readonly maxRaisesPerRound?: number;
  /**
   * フィックスリミットで賭け額が倍になるストリート（0 起点）。
   * 省略すると倍にならない。ホールデムのリミットは1（ターン）から倍。
   */
  readonly bigBetFrom?: number;
}

// ============================================================
// 軸4: 役 — 何が強いか
// ============================================================

/**
 * 1枚のカードに課すランク条件。
 *
 * - fixed:    特定のランク（例: 'A'）
 * - oneOf:    いずれか（例: 素数ランク 2,3,5,7,J,K）
 * - variable: 変数。同名の変数は同じランクを指し、異なる名前は異なるランクを指す。
 *             offset で相対指定できる。例) X, X, Y, Y+1, Y+2
 * - any:      任意
 */
export type RankSpec =
  | { readonly type: 'fixed'; readonly value: Rank }
  | { readonly type: 'oneOf'; readonly values: readonly Rank[] }
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
  | { readonly type: 'consecutive' }
  /** 全枚数が相異なるランク */
  | { readonly type: 'allDifferentRank' };

export interface HandPattern {
  /** 条件を課すカード。 */
  readonly cards: readonly CardCondition[];
  readonly global: readonly GlobalCondition[];
}

export interface HandRanking {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly pattern: HandPattern;
}

/** どのカードがワイルドか。 */
export type WildSelector =
  /** ジョーカー（deck.jokers で入れた札）。 */
  | { readonly kind: 'joker' }
  /** 特定のランクの札すべて（「2がワイルド」など）。 */
  | { readonly kind: 'rank'; readonly ranks: readonly Rank[] }
  /** 特定のカードだけ（「ハートのQだけワイルド」など）。 */
  | { readonly kind: 'card'; readonly cards: readonly { readonly rank: Rank; readonly suit: Suit }[] };

export interface WildRule {
  readonly cards: WildSelector;
  /**
   * 何に化けられるか。省略するとデッキにある任意のカード。
   * 絞ると「スートは変えられるがランクは変えられない」といった制限も書ける。
   */
  readonly becomes?: {
    readonly ranks?: readonly Rank[];
    readonly suits?: readonly Suit[];
  };
}

export interface RankingRules {
  /** 役を強い順に並べたもの。index 0 が最強。 */
  readonly hands: readonly HandRanking[];
  /** ワイルドカードの扱い。省略するとワイルドなし。 */
  readonly wilds?: readonly WildRule[];
}

// ============================================================
// 軸5: 卓の作法 — 勝敗には関わらないが場を左右するもの
// ============================================================

/** 自分の手札をどこまで見せられるか。 */
export type ShowCardsPolicy = 'none' | 'one' | 'any';

export interface TableOptions {
  /**
   * ディーラーが札を1枚だけ表にしてしまう確率（1ハンドあたり、0〜1）。
   *
   * **これはミスディールではない。** 実際の手順どおり、表になった札は回収して
   * 山札の top から引き直し、その札はフロップのバーンカードとして使う。
   * 手は通常どおり続行する。本人の手札が公開されるわけではなく、
   * 全員が知るのは「その札はもう出ない」という情報だけ。
   *
   * 確率で起きる事象だが、**乱数は seed から導く**。そうしないと配牌の検証
   * （docs/fairness.md）が壊れる。同じ seed からは同じ結果が再現される。
   */
  readonly exposedCardChance?: number;
  /**
   * 2枚以上表にしてしまい、**配り直し**になる確率（1ハンドあたり、0〜1）。
   *
   * こちらが本来の「ミスディール」。手札を回収して最初から配り直す。
   */
  readonly misdealChance?: number;
  /**
   * 表にしてしまった札を、最初のバーンカードとして使うか。既定 true。
   *
   * true（Robert's Rules）だと、引き直しに使う「山札の top」が本来バーンに
   * なるはずだった札なので、**露出した札がバーンの席に収まり、場に出る札は
   * 一切変わらない**。ディーラーのミスで場が変わらないよう組まれた手順。
   *
   * false にすると、露出した札は捨てたうえで通常どおり山札からも焼く。
   * 場に出る札がずれ、1ハンドで消える枚数も1枚増える。
   */
  readonly exposedCardBecomesBurn?: boolean;
  /** ハンドが途中で終わったとき、配られるはずだった札を見せる。 */
  readonly rabbitHunt?: boolean;
  /** 自分の手札を見せられるか。既定は 'none'。 */
  readonly showCards?: ShowCardsPolicy;
  /**
   * オールイン決着で、残りの札を何本まで走らせるか。
   *
   * 省略または 1 なら普通どおり1本。2 を指定すると「2本走るか」を
   * 全員に聞けるようになる（1人でも断れば1本）。3 以上も同じ仕組みで動く。
   */
  readonly runItTwice?: { readonly max: number };
}

// ============================================================
// バリアント
// ============================================================

export interface Variant {
  readonly id: string;
  readonly name: string;
  /** 何が標準と違うのかの一行説明。遊ぶ前に読めるようにしておく。 */
  readonly description?: string;
  readonly deck: DeckRules;
  readonly structure: HandStructure;
  readonly betting: BettingRules;
  readonly ranking: RankingRules;
  /** 卓の作法。省略するとすべて無効。 */
  readonly options?: TableOptions;
}

// ============================================================
// ゲーム状態
// ============================================================

/**
 * 進行の段階。
 *
 * ストリート名（フロップ・ターン・リバー）はここに焼き込まない。
 * バリアントが決めるものなので、どのストリートにいるかは streetIndex で持つ。
 */
export type Phase = 'waiting' | 'betting' | 'runChoice' | 'showdown';

/** 場が開く前（ホールデムのプリフロップ）を表す streetIndex。 */
export const PREFLOP = -1;

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 席番号（0-origin）。番号が増える向きが時計回り。 */
  readonly seat: number;
  readonly chips: number;
  /** このベッティングラウンドで出している額。 */
  readonly bet: number;
  /**
   * このハンドで出した総額（bet を含む）。
   * オールインが絡むサイドポットの計算にはラウンドごとの額では足りない。
   */
  readonly committed: number;
  readonly holeCards: readonly Card[];
  /**
   * 表になっているホールカードの位置。誰にでも見える。
   *
   * 本人が見せた札と、将来のスタッドで最初から表向きに配られる札がここに入る。
   * project() はこの位置だけを見て「誰に何が見えるか」を決める。
   *
   * **ディーラーの露出はここには入らない。** 実際の手順では表になった札は
   * 回収して引き直すので、本人の手札が公開されるわけではない
   * （→ GameState.exposedCards）。
   */
  readonly exposedHoleCards: readonly number[];
  /**
   * このハンドに配牌されているか。
   * 着席していても waiting や away なら参加しない。
   */
  readonly inHand: boolean;
  readonly folded: boolean;
  readonly allIn: boolean;
  /** このベッティングラウンドで行動済みか。 */
  readonly hasActed: boolean;
  /**
   * ハンド進行中に着席したため、次のハンドまで待機している状態。
   * poker-web-test で問題になった「途中参加者が現ハンドに混ざる」を防ぐ。
   */
  readonly waiting: boolean;
  /** 離席・切断中。手番が来たら自動フォールドされ、新しいハンドには参加しない。 */
  readonly away: boolean;
  /**
   * 次のハンドでストラドルを出す意思。
   *
   * ストラドルは配る前に決めるものなので、ハンドの途中では効かない。
   * 実際の卓でも「次から straddle する」と宣言しておく形になる。
   */
  readonly straddleOn: boolean;
  /**
   * ハンド進行中に退席を申し出た状態。即座に席から消すと、その人が
   * ポットに出した額の記録まで失われてサイドポットの計算が狂う。
   * フォールド扱いのまま席に残し、次のハンド開始時に実際に取り除く。
   */
  readonly leaving: boolean;
}

/** ポットの払い出し先と額。 */
export interface Payout {
  readonly playerId: string;
  readonly amount: number;
}

/** ショーダウンで公開された手。 */
export interface RevealedHand {
  readonly playerId: string;
  readonly holeCards: readonly Card[];
  readonly rankingId: string;
  readonly rankingName: string;
  /** Physical cards selected by the evaluator, including kickers and original wild cards. */
  readonly usedCards?: readonly Card[];
}

export interface HandHistoryStep {
  readonly kind: 'deal' | 'ante' | 'blind' | 'straddle' | 'fold' | 'check' | 'call' | 'raise' | 'timeout-check' | 'timeout-fold' | 'run-once' | 'run-agree' | 'collect' | 'burn' | 'board' | 'refund' | 'award';
  readonly playerId?: string;
  readonly amount?: number;
  readonly to?: number;
  readonly blind?: 'SB' | 'BB';
  readonly run?: number;
  readonly streetIndex: number;
  /** Public board cards only. Never includes seeds, hidden hands, or burn identities. */
  readonly boards: readonly (readonly Card[])[];
  readonly pot: number;
  readonly players: readonly Pick<Player, 'id' | 'name' | 'chips' | 'bet' | 'folded' | 'allIn'>[];
}

/**
 * 何本走るかの合意。
 *
 * 全員オールインで残りの札を開くだけになったとき、
 * 「2本走るか」を1人ずつ聞く。**1人でも断れば1本**（実際の卓の作法）。
 */
export interface RunChoice {
  /** まだ答えていない人。席順に並ぶ。 */
  readonly pending: readonly string[];
  /** 同意した人。 */
  readonly agreed: readonly string[];
}

/** 1本の走りの結果。2本以上走ったときだけ summary に入る。 */
export interface RunResult {
  readonly board: readonly Card[];
  readonly revealed: readonly RevealedHand[];
  /** この走りぶんの配当。ポットを本数で割ったものが元になる。 */
  readonly payouts: readonly Payout[];
}

/** ハンドの決着内容。 */
export interface HandSummary {
  readonly payouts: readonly Payout[];
  /** Pot awards only, excluding uncalled-bet refunds. Optional for older saved hands. */
  readonly awards?: readonly Payout[];
  /**
   * 公開された手。全員がフォールドして決着した場合は空
   * （勝者は手を見せる必要がない）。
   */
  readonly revealed: readonly RevealedHand[];
  /**
   * 配られるはずだったカード（ラビットハント）。
   * 途中で終わったハンドで、卓の作法として有効なときだけ埋まる。
   */
  readonly rabbit: readonly Card[];
  /**
   * 走りごとの結果。**2本以上走ったときだけ**入る。
   *
   * 1本しか走らないのが普通なので、いつも配列にすると読む側が
   * 常に [0] を書くことになる。payouts と revealed は1本目のものが
   * そのまま入っているので、2本走ったときだけここを見ればよい。
   */
  readonly runs?: readonly RunResult[];
}

export interface GameState {
  /** Per-player dead money, separate from live bets. Missing in older saved games means zero. */
  readonly ante?: number;
  /** Current hand's public action/transfer ledger; replaced on the next deal. */
  readonly history?: readonly HandHistoryStep[];
  readonly phase: Phase;
  /**
   * 今どのストリートか。PREFLOP(-1) は場が開く前。
   * 0 以降は variant.structure.streets の index。
   */
  readonly streetIndex: number;
  /** 卓の席数。 */
  readonly seatCount: number;
  readonly players: readonly Player[];
  readonly communityCards: readonly Card[];
  /**
   * 2本目以降のボード。1本しか走らなければ空。
   *
   * すでに開いている札は共有されるので、ここに入るのは**各走りの
   * ボード全体**（共有部分＋その走りで開いた札）。評価のとき
   * 「1本目か2本目か」で場合分けせずに済む。
   */
  readonly extraBoards: readonly (readonly Card[])[];
  /** 何本走るかを聞いている最中なら、その状況。 */
  readonly runChoice: RunChoice | null;
  /** 未配の山札。project() で視点に応じて伏せられる。 */
  readonly deck: readonly Card[];
  /**
   * バーンカード。進行には使わないが、何枚どう落としたかを残しておくと
   * 配牌の検証で山札の消費が説明できる。project() では枚数だけ見せる。
   */
  readonly burned: readonly Card[];
  /**
   * ディーラーが表にしてしまい、回収された札。**全員に見える。**
   *
   * 誰の手にもないので手札の公開にはならないが、「その札はもう出ない」
   * という情報は全員が共有する。実際の手順どおり、次にバーンが要る
   * ストリートで山札の代わりにこれが使われるので、1ハンドで消える枚数は
   * 露出が無かった場合と変わらない。
   */
  readonly exposedCards: readonly Card[];
  /** このハンドで配り直しになった回数。0 なら一度で配れている。 */
  readonly misdeals: number;
  /** 場に出ている総額（各プレイヤーの committed の合計）。 */
  readonly pot: number;
  /** 現在のラウンドでコールに必要な額。 */
  readonly currentBet: number;
  /** 次のレイズで最低限上乗せしなければならない額。 */
  readonly minRaise: number;
  /**
   * このラウンドで入ったレイズの回数。
   * ブラインドとストラドルは数えない（自主的な上乗せではないため）。
   */
  readonly raisesThisRound: number;
  readonly dealerSeat: number;
  /** 手番のプレイヤーID。誰の手番でもないときは null。 */
  readonly turnPlayerId: string | null;
  /** 掛け金。バリアントではなく卓の設定。 */
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly variant: Variant;
  /** 直前のハンドの決着内容。まだ決着していなければ null。 */
  readonly summary: HandSummary | null;
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
  | {
      readonly type: 'sit';
      readonly playerId: string;
      readonly name: string;
      readonly seat: number;
      readonly chips: number;
    }
  | { readonly type: 'leave'; readonly playerId: string }
  | { readonly type: 'setAway'; readonly playerId: string; readonly away: boolean }
  | { readonly type: 'startHand'; readonly seed: number; readonly entropy?: readonly number[] }
  | { readonly type: 'fold'; readonly playerId: string }
  | { readonly type: 'check'; readonly playerId: string }
  | { readonly type: 'call'; readonly playerId: string }
  /** to はこのラウンドで出す合計額（上乗せ分ではない）。 */
  | { readonly type: 'raise'; readonly playerId: string; readonly to: number }
  | { readonly type: 'timeout'; readonly playerId: string }
  /** 自分のホールカードを1枚表にする。index は手札の何枚目か。 */
  | { readonly type: 'showCard'; readonly playerId: string; readonly index: number }
  /** 次のハンドでストラドルを出すかどうか。 */
  | { readonly type: 'setStraddle'; readonly playerId: string; readonly on: boolean }
  /** 2本走ることに同意するか。1人でも断れば1本になる。 */
  | { readonly type: 'runItTwice'; readonly playerId: string; readonly agree: boolean };

/** 不正な Action は状態を変えずに理由を返す。 */
export interface RejectedAction {
  readonly reason: string;
}
