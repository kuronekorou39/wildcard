import {
  type Action,
  type Card,
  type GameState,
  type HandSummary,
  type Payout,
  type Player,
  type RejectedAction,
  type RevealedHand,
  type RunResult,
  type Variant,
  PREFLOP,
} from '../types.js';
import { buildDeck, shuffle } from '../deck.js';
import { createRng } from '../rng.js';
import { type HandResult, evaluateHand } from '../rules/evaluate.js';
import { STANDARD_VARIANT } from '../rules/presets.js';
import {
  exposedCardBecomesBurnOf,
  exposedCardChanceOf,
  extraCardsFor,
  maxRunsOf,
  misdealChanceOf,
  rabbitCards,
  rabbitHuntEnabled,
  requiredCards,
  runItTwiceEnabled,
  showCardsPolicyOf,
} from '../variant.js';
import { awardPotsAcrossRuns, buildPotLayers, returnUncalledBets } from './pot.js';
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
    extraBoards: [],
    runChoice: null,
    streetIndex: PREFLOP,
    seatCount: options.seatCount ?? 10,
    players: [],
    communityCards: [],
    deck: [],
    burned: [],
    exposedCards: [],
    misdeals: 0,
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
      const need = requiredCards(
        state.variant.structure,
        players,
        extraCardsFor(state.variant),
      );
      const have = buildDeck(state.variant.deck).length;
      if (have < need) {
        return { reason: `${players}人で遊ぶには${need}枚必要だが、デッキは${have}枚しかない` };
      }
      return null;
    }

    case 'showCard': {
      const player = byId(state, action.playerId);
      if (!player) return { reason: '着席していない' };
      if (showCardsPolicyOf(state.variant) === 'none') {
        return { reason: 'この卓では手札を見せられない' };
      }
      if (action.index < 0 || action.index >= player.holeCards.length) {
        return { reason: 'その位置に札がない' };
      }
      if (player.exposedHoleCards.includes(action.index)) {
        return { reason: 'もう表になっている' };
      }
      // 勝負の途中に見せると駆け引きが成立しなくなる。降りた後か決着後だけ。
      if (state.phase === 'betting' && !player.folded) {
        return { reason: '勝負がついてから見せられる' };
      }
      if (showCardsPolicyOf(state.variant) === 'one' && player.exposedHoleCards.length >= 1) {
        return { reason: 'この卓では1枚までしか見せられない' };
      }
      return null;
    }

    case 'runItTwice': {
      if (state.phase !== 'runChoice') return { reason: '今は聞いていない' };
      if (state.turnPlayerId !== action.playerId) return { reason: '手番ではない' };
      return null;
    }

    case 'fold':
    case 'check':
    case 'call':
    case 'raise':
    case 'timeout': {
      // 合意を待っている最中の時間切れは「断った」こと。
      if (action.type === 'timeout' && state.phase === 'runChoice') {
        return state.turnPlayerId === action.playerId ? null : { reason: '手番ではない' };
      }
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
    case 'showCard':
      return updatePlayer(state, action.playerId, (p) => ({
        ...p,
        exposedHoleCards: [...p.exposedHoleCards, action.index],
      }));
    case 'runItTwice':
      return applyRunChoice(state, action.playerId, action.agree);
    case 'timeout':
      // 合意を待っている最中なら「断った」こと。少ないほうに倒す。
      if (state.phase === 'runChoice') return applyRunChoice(state, action.playerId, false);
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
    exposedHoleCards: [],
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
    exposedHoleCards: [],
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
  const dealt = dealHand(fresh, dealOrder, state.variant, seed);

  let players = dealt.players.map<Player>((p) => {
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
    extraBoards: [],
    runChoice: null,
    deck: dealt.deck,
    burned: [],
    exposedCards: dealt.exposedCards,
    misdeals: dealt.misdeals,
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

interface DealResult {
  readonly players: Player[];
  readonly deck: Card[];
  /** ディーラーが表にしてしまい、回収された札。 */
  readonly exposedCards: Card[];
  readonly misdeals: number;
}

/** 配り直しの上限。無限に回らないようにする。 */
const MAX_MISDEALS = 5;

/**
 * 実際の手順どおりに配る。
 *
 * ディーラーが札を表にしてしまったときの扱いは、実際のポーカーでは2通りある
 * （Robert's Rules / TDA）。
 *
 * **1枚だけ表にした場合はミスディールではない。** その札を回収し、配り終えた
 * 後に山札の top から引き直す。表になった札はフロップのバーンカードとして使う。
 * 手は通常どおり続行するので、**本人の手札が公開されるわけではない**。
 * 全員が知るのは「その札はもう出ない」という情報だけ。
 *
 * **2枚以上表にして初めてミスディール**で、手札を回収して最初から配り直す。
 *
 * 引き直しで1枚多く引き、そのぶんフロップのバーンを山札から取らないので、
 * 1ハンドで消える枚数は露出が無かった場合と変わらない。デッキの検算が狂わない。
 *
 * 乱数はすべて seed から導くので、同じ seed からは同じ結果が再現される
 * （配り直しも含めて）。配牌の検証が壊れない。
 */
function dealHand(
  fresh: readonly Player[],
  dealOrder: readonly number[],
  variant: Variant,
  seed: number,
): DealResult {
  const misdealChance = misdealChanceOf(variant);
  const exposedChance = exposedCardChanceOf(variant);
  let attemptSeed = seed;

  for (let misdeals = 0; ; misdeals++) {
    const deck = shuffle(buildDeck(variant.deck), attemptSeed);
    const hole = new Map<number, Card[]>(dealOrder.map((seat) => [seat, []]));
    let cursor = 0;
    for (let round = 0; round < variant.structure.holeCards; round++) {
      for (const seat of dealOrder) {
        hole.get(seat)!.push(deck[cursor]!);
        cursor++;
      }
    }

    const rng = createRng((attemptSeed ^ 0x7f4a7c15) >>> 0);

    // 2枚以上表にしてしまった＝ミスディール。最初から配り直す。
    if (misdeals < MAX_MISDEALS && rng() < misdealChance) {
      attemptSeed = (attemptSeed * 1664525 + 1013904223) >>> 0;
      continue;
    }

    const players = fresh.map<Player>((p) =>
      p.inHand ? { ...p, holeCards: hole.get(p.seat) ?? [] } : p,
    );

    // 1枚だけ表にしてしまった。回収して引き直す（ミスディールではない）。
    const exposedCards: Card[] = [];
    if (rng() < exposedChance) {
      const dealtTo = players.filter((p) => p.inHand && p.holeCards.length > 0);
      const replacement = deck[cursor];
      if (dealtTo.length > 0 && replacement !== undefined) {
        const victim = dealtTo[Math.floor(rng() * dealtTo.length)]!;
        const index = Math.floor(rng() * victim.holeCards.length);
        exposedCards.push(victim.holeCards[index]!);
        cursor++;

        const replaced = victim.holeCards.map((card, i) => (i === index ? replacement : card));
        return {
          players: players.map((p) => (p.id === victim.id ? { ...p, holeCards: replaced } : p)),
          deck: deck.slice(cursor),
          exposedCards,
          misdeals,
        };
      }
    }

    return { players, deck: deck.slice(cursor), exposedCards, misdeals };
  }
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
  if (state.streetIndex + 1 >= streets.length) return settle(state);

  // これ以上ベッティングが無いなら、開く前に「何本走るか」を聞く。
  const asking = askRuns(state);
  if (asking) return asking;

  const opened = openStreet(state);

  // 行動できるのが1人以下ならベッティングは成立しない。次のストリートへ。
  if (canActPlayers(opened).length <= 1) return advanceStreet(opened);

  // フロップ以降はディーラーの次から。ヘッズアップならそれが BB になり、これも正しい。
  return assignTurn(opened, (opened.dealerSeat + 1) % opened.seatCount);
}

/** 次のストリートを1つ開く。ベッティングの手番は決めない。 */
function openStreet(state: GameState): GameState {
  const street = state.variant.structure.streets[state.streetIndex + 1]!;
  const burn = street.burn ?? 0;

  // ディーラーが表にしてしまった札は、最初のバーンの席に収まる（既定）。
  // 引き直しに使った「山札の top」が本来バーンになるはずだった札なので、
  // こうすると**場に出る札が露出の有無で変わらない**。そのための手順。
  const pending = state.streetIndex === PREFLOP ? state.exposedCards : [];
  const fromExposed = exposedCardBecomesBurnOf(state.variant)
    ? Math.min(burn, pending.length)
    : 0;
  const fromDeck = burn - fromExposed;

  return {
    ...state,
    streetIndex: state.streetIndex + 1,
    // バーンに使うかどうかに関わらず、露出した札は死んでいる。
    burned: [...state.burned, ...pending, ...state.deck.slice(0, fromDeck)],
    communityCards: [
      ...state.communityCards,
      ...state.deck.slice(fromDeck, fromDeck + street.cards),
    ],
    deck: state.deck.slice(fromDeck + street.cards),
    currentBet: 0,
    minRaise: state.bigBlind,
    turnPlayerId: null,
    players: state.players.map((p) => ({ ...p, bet: 0, hasActed: false })),
  };
}

// ============================================================
// ランイットトゥワイス
// ============================================================

/**
 * 「何本走るか」を聞くべき場面なら、聞き始めた state を返す。
 *
 * 聞くのは **これ以上ベッティングが無く、まだ開く札が残っている**とき。
 * つまり全員がオールイン（か、降りずに残っているのが1人ぶんの行動だけ）で、
 * あとは札をめくるだけになった場面。そこが実際の卓でも持ちかける場面になる。
 */
function askRuns(state: GameState): GameState | null {
  if (!runItTwiceEnabled(state.variant)) return null;
  if (state.runChoice !== null) return null;
  if (contenders(state).length < 2) return null;
  // まだ2人以上が行動できるなら、ベッティングが続く。聞くのは早い。
  if (canActPlayers(state).length > 1) return null;

  // 席順に聞く。順番が決まっていないと、誰から聞いたかで結果が変わって見える。
  const seats = orderClockwise(
    contenders(state).map((p) => p.seat),
    (state.dealerSeat + 1) % state.seatCount,
    state.seatCount,
  );
  const pending = seats.map((seat) => state.players.find((p) => p.seat === seat)!.id);

  return {
    ...state,
    phase: 'runChoice',
    runChoice: { pending, agreed: [] },
    turnPlayerId: pending[0] ?? null,
  };
}

/**
 * 合意の返事。**1人でも断れば1本**。
 *
 * 全員が同意して初めて複数本になる。実際の卓の作法どおりで、
 * 「2人のうち1人が嫌がったのに2本走った」が起きない。
 */
function applyRunChoice(state: GameState, playerId: string, agree: boolean): GameState {
  const choice = state.runChoice;
  if (!choice) return state;

  if (!agree) return dealOutRuns(state, 1);

  const pending = choice.pending.filter((id) => id !== playerId);
  if (pending.length === 0) return dealOutRuns(state, maxRunsOf(state.variant));

  return {
    ...state,
    runChoice: { pending, agreed: [...choice.agreed, playerId] },
    turnPlayerId: pending[0]!,
  };
}

/** 残りのストリートを全部開く。ベッティングは起きない。 */
function dealRemaining(state: GameState): GameState {
  let current = state;
  while (current.streetIndex + 1 < current.variant.structure.streets.length) {
    current = openStreet(current);
  }
  return current;
}

/**
 * 残りの札を runs 本ぶん走らせて決着する。
 *
 * すでに開いている札は共有で、**開き直すのは残りのストリートだけ**。
 * 山札は走るたびに続きから使うので、同じ札が2本のボードに出ることはない。
 */
function dealOutRuns(state: GameState, runs: number): GameState {
  const start: GameState = {
    ...state,
    phase: 'betting',
    runChoice: null,
    turnPlayerId: null,
  };

  const first = dealRemaining(start);
  if (runs <= 1) return settle(first);

  const extraBoards: (readonly Card[])[] = [];
  let deck = first.deck;
  let burned = first.burned;

  for (let run = 1; run < runs; run++) {
    const again = dealRemaining({
      ...start,
      deck,
      burned,
      // 表にしてしまった札は1枚しかない。1本目のバーンで使い切っている。
      exposedCards: [],
    });
    extraBoards.push(again.communityCards);
    deck = again.deck;
    burned = again.burned;
  }

  return settle({ ...first, deck, burned, extraBoards });
}

// ============================================================
// 決着
// ============================================================

/**
 * そのハンドで走ったボード全部。1本なら要素1つ。
 *
 * 「1本目か2本目か」で場合分けせずに読めるようにするための入口。
 * VisibleState からも同じように呼べる。
 */
export const boardsOf = (
  state: Pick<GameState, 'communityCards' | 'extraBoards'>,
): readonly (readonly Card[])[] => [state.communityCards, ...(state.extraBoards ?? [])];

function settle(state: GameState): GameState {
  const { players: refunded, refunds } = returnUncalledBets(state.players);
  const live = refunded.filter((p) => p.inHand && !p.folded);

  // 2本走ったなら、ボードの数だけ勝負がある。1本なら要素1つの配列。
  const boards = boardsOf(state);
  const handsPerRun: Map<string, HandResult>[] = [];
  const revealedPerRun: RevealedHand[][] = [];

  if (live.length > 1) {
    for (const board of boards) {
      const hands = new Map<string, HandResult>();
      for (const player of live) {
        // 使用枚数の制約は evaluateHand が見る。オマハなら手札2枚＋場3枚に限られる。
        const result = evaluateHand(player.holeCards, board, state.variant);
        if (result) hands.set(player.id, result);
      }
      handsPerRun.push(hands);
      revealedPerRun.push(
        live
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
          .filter((r): r is RevealedHand => r !== null),
      );
    }
  }

  const revealed = revealedPerRun[0] ?? [];
  const layers = buildPotLayers(refunded);
  const seatOf = new Map(refunded.map((p) => [p.id, p.seat]));

  const awarded =
    live.length === 1
      ? // 全員が降りたので役を見る必要がない。勝者は手を見せずに取る。
        {
          payouts: [
            { playerId: live[0]!.id, amount: layers.reduce((sum, l) => sum + l.amount, 0) },
          ] as Payout[],
          perRun: [] as Payout[][],
        }
      : awardPotsAcrossRuns(layers, handsPerRun, seatOf, state.dealerSeat, state.seatCount);
  const winnings: Payout[] = awarded.payouts;

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

  // 途中で終わったハンドなら、配られるはずだった札を見せる。
  // 山札はすでに確定しているので、残りの段取りをなぞるだけで出る。
  const rabbit = rabbitHuntEnabled(state.variant)
    ? rabbitCards(state.variant.structure, state.streetIndex, state.deck)
    : [];

  // 走りごとの内訳は、2本以上走ったときだけ残す。
  // 1本しか走らないのが普通なので、いつも入れると読む側が常に [0] を書くことになる。
  const runs: RunResult[] | undefined =
    boards.length > 1
      ? boards.map((board, i) => ({
          board,
          revealed: revealedPerRun[i] ?? [],
          payouts: awarded.perRun[i] ?? [],
        }))
      : undefined;

  const summary: HandSummary = {
    payouts: [...credited.entries()].map(([playerId, amount]) => ({ playerId, amount })),
    revealed,
    rabbit,
    ...(runs ? { runs } : {}),
  };

  return {
    ...state,
    phase: 'showdown',
    players,
    pot: 0,
    currentBet: 0,
    turnPlayerId: null,
    runChoice: null,
    summary,
  };
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
