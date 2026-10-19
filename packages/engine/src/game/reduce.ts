import {
  type Action,
  type Card,
  type GameState,
  type HandSummary,
  type Payout,
  type Player,
  type RejectedAction,
  type RevealedHand,
  type Variant,
  PREFLOP,
} from '../types.js';
import { buildDeck, shuffle } from '../deck.js';
import { type HandResult, evaluateHand } from '../rules/evaluate.js';
import { STANDARD_VARIANT } from '../rules/presets.js';
import { requiredCards } from '../variant.js';
import { awardPots, buildPotLayers, returnUncalledBets } from './pot.js';
import { blindPositions, firstClockwise, orderClockwise } from './seats.js';

export interface CreateGameOptions {
  readonly seatCount?: number;
  readonly smallBlind?: number;
  readonly bigBlind?: number;
  readonly variant?: Variant;
  readonly dealerSeat?: number;
}

export function createGame(options: CreateGameOptions = {}): GameState {
  return {
    phase: 'waiting',
    streetIndex: PREFLOP,
    seatCount: options.seatCount ?? 10,
    players: [],
    communityCards: [],
    deck: [],
    burned: [],
    pot: 0,
    currentBet: 0,
    minRaise: options.bigBlind ?? 20,
    dealerSeat: options.dealerSeat ?? 0,
    turnPlayerId: null,
    smallBlind: options.smallBlind ?? 10,
    bigBlind: options.bigBlind ?? 20,
    variant: options.variant ?? STANDARD_VARIANT,
    summary: null,
  };
}

// ============================================================
// 問い合わせ
// ============================================================

const byId = (state: GameState, playerId: string): Player | undefined =>
  state.players.find((p) => p.id === playerId);

/** このハンドに参加していて、まだフォールドしていないプレイヤー。 */
const contenders = (state: GameState): Player[] =>
  state.players.filter((p) => p.inHand && !p.folded);

/** まだ行動できるプレイヤー。オールイン済みは行動できない。 */
const canActPlayers = (state: GameState): Player[] =>
  state.players.filter((p) => p.inHand && !p.folded && !p.allIn);

/**
 * legalActions が必要とする最小の情報。
 *
 * GameState でも、伏せ済みの VisibleState でも満たせるようにしてある。
 * こうしておくと UI はホールカードの見えない状態からでも同じ関数を呼べるので、
 * ベット額の下限・上限を自前で計算し直す必要がなくなる。
 */
export interface BettingView {
  readonly currentBet: number;
  readonly minRaise: number;
  readonly turnPlayerId: string | null;
  readonly players: readonly Pick<
    Player,
    'id' | 'bet' | 'chips' | 'inHand' | 'folded' | 'allIn'
  >[];
}

export interface LegalActions {
  readonly canFold: boolean;
  readonly canCheck: boolean;
  readonly canCall: boolean;
  /** コールに必要な額。手持ちが足りなければオールイン額になる。 */
  readonly callAmount: number;
  readonly canRaise: boolean;
  /** レイズ額の下限（このラウンドで出す合計額）。 */
  readonly minRaiseTo: number;
  /** レイズ額の上限＝オールイン（このラウンドで出す合計額）。 */
  readonly maxRaiseTo: number;
}

/**
 * そのプレイヤーが今取れる選択肢。
 *
 * UI がベット額の下限・上限を自前で計算し直すと、必ずどこかでエンジンと食い違う。
 * ルールの判断はここに集約して、UI は結果を表示するだけにする。
 */
export function legalActions(state: BettingView, playerId: string): LegalActions | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || state.turnPlayerId !== playerId) return null;
  if (!player.inHand || player.folded || player.allIn) return null;

  const toCall = Math.max(0, state.currentBet - player.bet);
  const callAmount = Math.min(toCall, player.chips);
  const maxRaiseTo = player.bet + player.chips;
  // 本来の下限に手が届かない場合でも、オールインなら出せる（ショートオールイン）。
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);

  return {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0,
    callAmount,
    canRaise: maxRaiseTo > state.currentBet,
    minRaiseTo,
    maxRaiseTo,
  };
}

/** 不正な Action の理由。問題がなければ null。 */
export function validate(state: GameState, action: Action): RejectedAction | null {
  switch (action.type) {
    case 'sit': {
      if (action.seat < 0 || action.seat >= state.seatCount) return { reason: '席番号が範囲外' };
      if (state.players.some((p) => p.seat === action.seat)) return { reason: 'その席は空いていない' };
      if (byId(state, action.playerId)) return { reason: 'すでに着席している' };
      if (action.chips <= 0) return { reason: 'チップが0以下' };
      return null;
    }

    case 'leave':
    case 'setAway':
      return byId(state, action.playerId) ? null : { reason: '着席していない' };

    case 'startHand': {
      if (state.phase === 'betting') return { reason: 'ハンドの進行中' };
      const players = eligibleForNextHand(state).length;
      if (players < 2) return { reason: '参加者が2人未満' };

      // 配り始めてから山札が尽きるより、始める前に弾く。
      const need = requiredCards(state.variant.structure, players);
      const have = buildDeck(state.variant.deck).length;
      if (have < need) {
        return { reason: `${players}人で遊ぶには${need}枚必要だが、デッキは${have}枚しかない` };
      }
      return null;
    }

    case 'fold':
    case 'check':
    case 'call':
    case 'raise':
    case 'timeout': {
      const legal = legalActions(state, action.playerId);
      if (!legal) return { reason: '手番ではない' };
      if (action.type === 'check' && !legal.canCheck) return { reason: 'チェックできない' };
      if (action.type === 'raise') {
        if (!legal.canRaise) return { reason: 'レイズできない' };
        if (action.to > legal.maxRaiseTo) return { reason: '手持ちを超えている' };
        if (action.to < legal.minRaiseTo) return { reason: 'レイズ額が下限未満' };
      }
      return null;
    }
  }
}

// ============================================================
// reduce
// ============================================================

/**
 * エンジンの中核。state と action から次の state を作る純粋関数。
 *
 * 通信も時間も乱数も持たない（原則1）。時間切れは外から渡される 'timeout'
 * アクションであり、シャッフルの乱数は 'startHand' の seed である。
 * 不正なアクションは状態を変えずに同じ state を返す（理由は validate で取れる）。
 */
export function reduce(state: GameState, action: Action): GameState {
  if (validate(state, action)) return state;

  switch (action.type) {
    case 'sit':
      return applySit(state, action.playerId, action.name, action.seat, action.chips);
    case 'leave':
      return applyLeave(state, action.playerId);
    case 'setAway':
      return applySetAway(state, action.playerId, action.away);
    case 'startHand':
      return startHand(state, action.seed);
    case 'fold':
      return actThenAdvance(state, action.playerId, (p) => ({ ...p, folded: true, hasActed: true }));
    case 'check':
      return actThenAdvance(state, action.playerId, (p) => ({ ...p, hasActed: true }));
    case 'call':
      return actThenAdvance(state, action.playerId, (p) => payTo(p, state.currentBet));
    case 'raise':
      return applyRaise(state, action.playerId, action.to);
    case 'timeout':
      // 時間切れは「払う必要がなければチェック、あればフォールド」。
      return state.currentBet > (byId(state, action.playerId)?.bet ?? 0)
        ? reduce(state, { type: 'fold', playerId: action.playerId })
        : reduce(state, { type: 'check', playerId: action.playerId });
  }
}

// ============================================================
// 卓の出入り
// ============================================================

function applySit(
  state: GameState,
  playerId: string,
  name: string,
  seat: number,
  chips: number,
): GameState {
  const player: Player = {
    id: playerId,
    name,
    seat,
    chips,
    bet: 0,
    committed: 0,
    holeCards: [],
    inHand: false,
    folded: false,
    allIn: false,
    hasActed: false,
    // ハンド進行中に座った人は現ハンドには混ぜず、次のハンドから参加させる。
    waiting: state.phase === 'betting',
    away: false,
    leaving: false,
  };
  return { ...state, players: [...state.players, player] };
}

function applyLeave(state: GameState, playerId: string): GameState {
  const player = byId(state, playerId);
  if (!player) return state;

  // ハンドに参加していないなら、その場で席を空けられる。
  if (!player.inHand) {
    return { ...state, players: state.players.filter((p) => p.id !== playerId) };
  }

  // 参加中ならフォールド扱いで席に残し、次のハンド開始時に取り除く。
  // ポットに出した額の記録を失わないため（詳細は Player.leaving）。
  const marked = updatePlayer(state, playerId, (p) => ({
    ...p,
    folded: true,
    hasActed: true,
    leaving: true,
    away: true,
  }));

  if (state.turnPlayerId !== playerId) return marked;
  return afterAction(marked, player.seat);
}

function applySetAway(state: GameState, playerId: string, away: boolean): GameState {
  const player = byId(state, playerId);
  if (!player) return state;

  const updated = updatePlayer(state, playerId, (p) => ({ ...p, away }));

  // 離席した本人の手番だったなら自動フォールドで進行を止めない。
  if (away && state.turnPlayerId === playerId && player.inHand && !player.folded) {
    return reduce(updated, { type: 'fold', playerId });
  }
  return updated;
}

// ============================================================
// ハンドの開始
// ============================================================

/** 次のハンドに参加できるプレイヤー。 */
function eligibleForNextHand(state: GameState): Player[] {
  return state.players.filter((p) => !p.leaving && !p.away && p.chips > 0);
}

function startHand(state: GameState, seed: number): GameState {
  const remaining = state.players.filter((p) => !p.leaving);
  const participants = remaining.filter((p) => !p.away && p.chips > 0);
  const seats = participants.map((p) => p.seat);

  // 最初のハンドは現在のボタン位置を尊重し、2回目以降は時計回りに1つ送る。
  const firstHand = state.summary === null && state.phase === 'waiting';
  const dealerSeat = firstHand
    ? (firstClockwise(seats, state.dealerSeat, state.seatCount) ?? state.dealerSeat)
    : (firstClockwise(seats, (state.dealerSeat + 1) % state.seatCount, state.seatCount) ??
      state.dealerSeat);

  const blinds = blindPositions(seats, dealerSeat, state.seatCount);
  if (!blinds) return state;

  const participantIds = new Set(participants.map((p) => p.id));
  const fresh = remaining.map<Player>((p) => ({
    ...p,
    bet: 0,
    committed: 0,
    holeCards: [],
    inHand: participantIds.has(p.id),
    folded: false,
    allIn: false,
    hasActed: false,
    // 待機していた人はここで解除され、このハンドから参加する。
    waiting: false,
  }));

  // 配牌は SB から時計回りに1枚ずつ、手札の枚数ぶん周回する。実際の配り方と
  // 同じ順序にしておくと、seed からハンドを再現したときに現実の進行と一致する。
  const dealOrder = orderClockwise(seats, blinds.smallBlindSeat, state.seatCount);
  const deck = shuffle(buildDeck(state.variant.deck), seed);
  const hole = new Map<number, Card[]>(dealOrder.map((seat) => [seat, []]));
  let cursor = 0;
  for (let round = 0; round < state.variant.structure.holeCards; round++) {
    for (const seat of dealOrder) {
      hole.get(seat)!.push(deck[cursor]!);
      cursor++;
    }
  }

  let players = fresh.map<Player>((p) =>
    p.inHand ? { ...p, holeCards: hole.get(p.seat) ?? [] } : p,
  );

  players = players.map<Player>((p) => {
    if (p.seat === blinds.smallBlindSeat) return postBlind(p, state.smallBlind);
    if (p.seat === blinds.bigBlindSeat) return postBlind(p, state.bigBlind);
    return p;
  });

  const started: GameState = {
    ...state,
    phase: 'betting',
    streetIndex: PREFLOP,
    players,
    communityCards: [],
    deck: deck.slice(cursor),
    burned: [],
    pot: totalCommitted(players),
    // ショートオールインでブラインドを払いきれなくても、コール額はブラインドのまま。
    currentBet: state.bigBlind,
    minRaise: state.bigBlind,
    dealerSeat,
    turnPlayerId: null,
    summary: null,
  };

  // ブラインドで全員オールインになった場合など、誰も行動できなければ
  // assignTurn がそのまま次のストリートへ送る。
  return assignTurn(started, blinds.firstToActSeat);
}

function postBlind(player: Player, amount: number): Player {
  const paid = Math.min(amount, player.chips);
  const chips = player.chips - paid;
  return {
    ...player,
    chips,
    bet: player.bet + paid,
    committed: player.committed + paid,
    allIn: chips === 0,
  };
}

// ============================================================
// プレイヤーの行動
// ============================================================

/** このラウンドでの合計が target になるまで払う。手持ちが足りなければオールイン。 */
function payTo(player: Player, target: number): Player {
  const need = Math.max(0, target - player.bet);
  const paid = Math.min(need, player.chips);
  const chips = player.chips - paid;
  return {
    ...player,
    chips,
    bet: player.bet + paid,
    committed: player.committed + paid,
    allIn: chips === 0,
    hasActed: true,
  };
}

function actThenAdvance(
  state: GameState,
  playerId: string,
  change: (player: Player) => Player,
): GameState {
  const player = byId(state, playerId);
  if (!player) return state;
  const updated = withPot(updatePlayer(state, playerId, change));
  return afterAction(updated, player.seat);
}

function applyRaise(state: GameState, playerId: string, to: number): GameState {
  const player = byId(state, playerId);
  if (!player) return state;

  const increment = to - state.currentBet;
  const raised = withPot(updatePlayer(state, playerId, (p) => payTo(p, to)));

  const next: GameState = {
    ...raised,
    currentBet: to,
    // ショートオールインで下限未満の上乗せだった場合、下限は下げない。
    minRaise: Math.max(state.minRaise, increment),
    // レイズが入ったので、他のプレイヤーはもう一度行動しなければならない。
    players: raised.players.map((p) =>
      p.id === playerId || p.folded || !p.inHand || p.allIn ? p : { ...p, hasActed: false },
    ),
  };

  return afterAction(next, player.seat);
}

/** 行動後の進行判断。行動した席の次から手番を探す。 */
function afterAction(state: GameState, actedSeat: number): GameState {
  return assignTurn(state, (actedSeat + 1) % state.seatCount);
}

/**
 * fromSeat（含む）から時計回りに手番を決める。進行の判断はすべてここに集約する。
 *
 * 1. 残り1人ならその場で決着
 * 2. ラウンドが閉じていれば次のストリートへ
 * 3. 行動すべき人が離席中なら自動フォールドして次を探す
 *
 * 3 が重要。離席した「瞬間」に手番だった場合だけを拾っても足りない。
 * 他人の手番中に離席し、あとから順番が回ってきた場合も折らないと、
 * そこで進行が永久に止まる（旧 poker-web-test が踏んでいた穴）。
 */
function assignTurn(state: GameState, fromSeat: number): GameState {
  let current = state;
  let seat = fromSeat;

  for (;;) {
    if (contenders(current).length <= 1) return settle(current);
    if (roundComplete(current)) return advanceStreet(current);

    const candidate = nextActorFrom(current, seat);
    if (!candidate) return advanceStreet(current);
    if (!candidate.away) return { ...current, turnPlayerId: candidate.id };

    current = withPot(
      updatePlayer(current, candidate.id, (p) => ({ ...p, folded: true, hasActed: true })),
    );
    seat = (candidate.seat + 1) % current.seatCount;
  }
}

/** 行動できる全員が行動済みで、かつ額が揃っているか。 */
function roundComplete(state: GameState): boolean {
  const active = canActPlayers(state);
  if (active.length === 0) return true;
  return active.every((p) => p.hasActed && p.bet === state.currentBet);
}

/** fromSeat（含む）から時計回りで、次に行動が必要なプレイヤー。 */
function nextActorFrom(state: GameState, fromSeat: number): Player | undefined {
  const needsAction = state.players.filter(
    (p) => p.inHand && !p.folded && !p.allIn && (!p.hasActed || p.bet < state.currentBet),
  );
  const seat = firstClockwise(
    needsAction.map((p) => p.seat),
    fromSeat,
    state.seatCount,
  );
  if (seat === null) return undefined;
  return needsAction.find((p) => p.seat === seat);
}

// ============================================================
// ストリートの進行
// ============================================================

/**
 * 次のストリートへ進む。
 *
 * ストリートの名前も枚数もエンジンは持たない。Variant の structure.streets を
 * 順に消化していくだけなので、フロップ6枚でも、カードを開かないラウンドでも、
 * 場の無いドロー系でも同じコードで動く。
 *
 * バーンカードは山札から落として burned に積む。結果の確率分布は変わらないが、
 * 1ハンドで消える枚数が変わるので、ルールとして指定できる必要がある。
 */
function advanceStreet(state: GameState): GameState {
  const streets = state.variant.structure.streets;
  const nextIndex = state.streetIndex + 1;
  if (nextIndex >= streets.length) return settle(state);

  const street = streets[nextIndex]!;
  const burn = street.burn ?? 0;

  const opened: GameState = {
    ...state,
    streetIndex: nextIndex,
    burned: [...state.burned, ...state.deck.slice(0, burn)],
    communityCards: [...state.communityCards, ...state.deck.slice(burn, burn + street.cards)],
    deck: state.deck.slice(burn + street.cards),
    currentBet: 0,
    minRaise: state.bigBlind,
    turnPlayerId: null,
    players: state.players.map((p) => ({ ...p, bet: 0, hasActed: false })),
  };

  // 行動できるのが1人以下ならベッティングは成立しない。次のストリートへ。
  if (canActPlayers(opened).length <= 1) return advanceStreet(opened);

  // フロップ以降はディーラーの次から。ヘッズアップならそれが BB になり、これも正しい。
  return assignTurn(opened, (opened.dealerSeat + 1) % opened.seatCount);
}

// ============================================================
// 決着
// ============================================================

function settle(state: GameState): GameState {
  const { players: refunded, refunds } = returnUncalledBets(state.players);
  const live = refunded.filter((p) => p.inHand && !p.folded);

  const hands = new Map<string, HandResult>();
  let revealed: RevealedHand[] = [];

  if (live.length > 1) {
    for (const player of live) {
      // 使用枚数の制約は evaluateHand が見る。オマハなら手札2枚＋場3枚に限られる。
      const result = evaluateHand(player.holeCards, state.communityCards, state.variant);
      if (result) hands.set(player.id, result);
    }
    revealed = live
      .map<RevealedHand | null>((player) => {
        const result = hands.get(player.id);
        if (!result) return null;
        return {
          playerId: player.id,
          holeCards: player.holeCards,
          rankingId: result.rankingId,
          rankingName: result.rankingName,
        };
      })
      .filter((r): r is RevealedHand => r !== null);
  }

  const layers = buildPotLayers(refunded);
  const seatOf = new Map(refunded.map((p) => [p.id, p.seat]));

  const winnings: Payout[] =
    live.length === 1
      ? // 全員が降りたので役を見る必要がない。勝者は手を見せずに取る。
        [{ playerId: live[0]!.id, amount: layers.reduce((sum, l) => sum + l.amount, 0) }]
      : awardPots(layers, hands, seatOf, state.dealerSeat, state.seatCount);

  const credited = new Map<string, number>();
  for (const { playerId, amount } of [...refunds, ...winnings]) {
    credited.set(playerId, (credited.get(playerId) ?? 0) + amount);
  }

  const players = refunded.map<Player>((p) => ({
    ...p,
    chips: p.chips + (winnings.find((w) => w.playerId === p.id)?.amount ?? 0),
    bet: 0,
    committed: 0,
    // ハンドが終わった時点で allIn は意味を失う。未コール分の返却や配当で
    // チップが戻ってくるため、立てたままにすると「チップを持っているのに
    // オールイン」という矛盾した状態が残る。
    allIn: false,
    // inHand と folded はショーダウンの表示に使うので残す。
  }));

  const summary: HandSummary = {
    payouts: [...credited.entries()].map(([playerId, amount]) => ({ playerId, amount })),
    revealed,
  };

  return { ...state, phase: 'showdown', players, pot: 0, currentBet: 0, turnPlayerId: null, summary };
}

// ============================================================
// 小道具
// ============================================================

function updatePlayer(
  state: GameState,
  playerId: string,
  change: (player: Player) => Player,
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.id === playerId ? change(p) : p)),
  };
}

const totalCommitted = (players: readonly Player[]): number =>
  players.reduce((sum, p) => sum + p.committed, 0);

/** pot は常に committed の合計であるという不変条件を保つ。 */
const withPot = (state: GameState): GameState => ({ ...state, pot: totalCommitted(state.players) });
