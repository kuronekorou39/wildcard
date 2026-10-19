/**
 * 席順の計算。
 *
 * 席番号が増える向きが時計回りで、seatCount で一周する。
 * 旧 poker-web-test では「有効プレイヤーの配列の添字」を席順として扱っていたため、
 * 空席が混ざると順番が狂い、ヘッズアップ（2人）では完全に破綻していた。
 * ここでは常に実際の席番号で計算する。
 */

/** start（含む）から時計回りに seatCount 個の席番号を並べる。 */
export function clockwiseFrom(start: number, seatCount: number): number[] {
  return Array.from({ length: seatCount }, (_, i) => (((start + i) % seatCount) + seatCount) % seatCount);
}

/**
 * seats のうち、start（含む）から時計回りで最初に現れる席を返す。
 * 一つも該当しなければ null。
 */
export function firstClockwise(
  seats: Iterable<number>,
  start: number,
  seatCount: number,
): number | null {
  const set = new Set(seats);
  if (set.size === 0) return null;
  for (const seat of clockwiseFrom(start, seatCount)) {
    if (set.has(seat)) return seat;
  }
  return null;
}

/** seats のうち、start を**含まず**時計回りで次に現れる席を返す。 */
export function nextClockwise(
  seats: Iterable<number>,
  start: number,
  seatCount: number,
): number | null {
  return firstClockwise(seats, (start + 1) % seatCount, seatCount);
}

/** seats を start（含む）起点の時計回り順に並べ替える。 */
export function orderClockwise(
  seats: readonly number[],
  start: number,
  seatCount: number,
): number[] {
  const set = new Set(seats);
  return clockwiseFrom(start, seatCount).filter((seat) => set.has(seat));
}

export interface BlindPositions {
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  /** プリフロップで最初に行動する席。 */
  readonly firstToActSeat: number;
}

/**
 * ブラインドの位置とプリフロップの開始位置を求める。
 *
 * 3人以上: SB = ディーラーの次、BB = その次、最初の行動は BB の次（UTG）。
 * ヘッズアップ（2人）: **ディーラーが SB** を出し、プリフロップはディーラーから始まる。
 *   これは3人以上の規則の単純な特例ではなく順序が逆転するため、
 *   「BB の次から」と一律に書くと2人プレイで必ず狂う。
 *
 * フロップ以降は人数にかかわらず「ディーラーの次の席」から始まる
 * （→ postflopFirstToActSeat）。ヘッズアップではそれが BB になり、これも正しい。
 */
export function blindPositions(
  seats: readonly number[],
  dealerSeat: number,
  seatCount: number,
): BlindPositions | null {
  if (seats.length < 2) return null;

  if (seats.length === 2) {
    // dealerSeat が空席を指していても壊れないよう、時計回りで最初の在席者に寄せる。
    const smallBlindSeat = firstClockwise(seats, dealerSeat, seatCount);
    if (smallBlindSeat === null) return null;
    const bigBlindSeat = nextClockwise(seats, smallBlindSeat, seatCount);
    if (bigBlindSeat === null) return null;
    return { smallBlindSeat, bigBlindSeat, firstToActSeat: smallBlindSeat };
  }

  const smallBlindSeat = nextClockwise(seats, dealerSeat, seatCount);
  if (smallBlindSeat === null) return null;
  const bigBlindSeat = nextClockwise(seats, smallBlindSeat, seatCount);
  if (bigBlindSeat === null) return null;
  const firstToActSeat = nextClockwise(seats, bigBlindSeat, seatCount);
  if (firstToActSeat === null) return null;

  return { smallBlindSeat, bigBlindSeat, firstToActSeat };
}

/** フロップ以降で最初に行動する席。人数にかかわらずディーラーの次。 */
export function postflopFirstToActSeat(
  seats: readonly number[],
  dealerSeat: number,
  seatCount: number,
): number | null {
  return nextClockwise(seats, dealerSeat, seatCount);
}
