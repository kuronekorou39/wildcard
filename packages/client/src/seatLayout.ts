/**
 * 席の画面配置。
 *
 * 旧 game-ui は10席ぶんの座標を CSS に直書きしていた（.seat-1 ... .seat-10）。
 * 見た目は成立していたが、席数を変えられず、自席を手前に回す処理も
 * 「1-indexed の席番号を6番に合わせる」という読みにくい式になっていた。
 * ここでは楕円上の座標を計算するので、席数は自由で回転も素直になる。
 */

/**
 * 実際の席番号を画面上の位置（スロット）に変換する。
 *
 * 自分が必ずスロット0、つまり画面手前の中央に来る。旧 game-ui の
 * 「開始した際、自分の位置を手前に表示する」を一般化したもの。
 * 観戦者（viewerSeat が null）のときは席番号そのままで並べる。
 */
export function displaySlot(seat: number, viewerSeat: number | null, seatCount: number): number {
  if (viewerSeat === null) return seat;
  return (((seat - viewerSeat) % seatCount) + seatCount) % seatCount;
}

export interface SeatPosition {
  /** 親要素に対する割合（%）。 */
  readonly left: number;
  readonly top: number;
}

/**
 * スロット番号を楕円上の位置に変換する。
 *
 * スロット0が真下（手前）で、番号が増えると画面上で時計回りに進む。
 * 画面座標は y が下向きなので、角度 90° が真下、角度を増やすと
 * 真下 → 左下 → 左 → 上 → 右 と回る（＝時計回り）。
 * エンジン側も席番号が増える向きを時計回りとしているので一致する。
 */
export function seatPosition(slot: number, seatCount: number): SeatPosition {
  const angle = Math.PI / 2 + (slot / seatCount) * Math.PI * 2;
  return {
    left: 50 + 50 * Math.cos(angle),
    top: 50 + 50 * Math.sin(angle),
  };
}

/** 縦画面は左右に人数を分散させ、中央の場札を空ける。席順は変えない。 */
export function portraitSeatPosition(slot: number, seatCount: number): SeatPosition {
  if (slot === 0) return { left: 50, top: 100 };
  if (seatCount === 2) return { left: 50, top: 0 };
  if (seatCount === 3) return { left: slot === 1 ? 0 : 100, top: 22 };
  if (seatCount === 4) return slot === 2
    ? { left: 50, top: 0 }
    : { left: slot === 1 ? 0 : 100, top: 58 };
  const progress = ((slot - 1) / (seatCount - 2)) * 8;
  if (progress <= 3) return { left: 0, top: 92 - progress * 24 };
  if (progress <= 4) return { left: (progress - 3) * 50, top: (4 - progress) * 20 };
  if (progress <= 5) return { left: 50 + (progress - 4) * 50, top: (progress - 4) * 20 };
  return { left: 100, top: 20 + (progress - 5) * 24 };
}

export function seatCoordinates(slot: number, seatCount: number) {
  const portrait = portraitSeatPosition(slot, seatCount);
  const landscape = seatPosition(slot, seatCount);
  return {
    '--portrait-x': `${portrait.left}%`, '--portrait-y': `${portrait.top}%`,
    '--landscape-x': `${landscape.left}%`, '--landscape-y': `${landscape.top}%`,
  };
}

export function seatSide(position: SeatPosition) {
  return position.left < 30 ? 'left' : position.left > 70 ? 'right' : position.top < 50 ? 'top' : 'bottom';
}
