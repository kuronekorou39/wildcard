import { describe, expect, it } from 'vitest';
import {
  blindPositions,
  clockwiseFrom,
  firstClockwise,
  nextClockwise,
  orderClockwise,
  postflopFirstToActSeat,
} from '../src/game/seats.js';

describe('時計回りの席順', () => {
  it('start を含んで一周する', () => {
    expect(clockwiseFrom(3, 6)).toEqual([3, 4, 5, 0, 1, 2]);
  });

  it('firstClockwise は start 自身も候補に含む', () => {
    expect(firstClockwise([2, 5, 8], 2, 10)).toBe(2);
    expect(firstClockwise([2, 5, 8], 3, 10)).toBe(5);
    expect(firstClockwise([2, 5, 8], 9, 10)).toBe(2);
  });

  it('nextClockwise は start 自身を除く', () => {
    expect(nextClockwise([2, 5, 8], 2, 10)).toBe(5);
    expect(nextClockwise([2, 5, 8], 8, 10)).toBe(2);
  });

  it('候補が空なら null', () => {
    expect(firstClockwise([], 0, 10)).toBeNull();
    expect(nextClockwise([], 0, 10)).toBeNull();
  });

  it('1人しかいなければ nextClockwise は自分自身に戻る', () => {
    expect(nextClockwise([4], 4, 10)).toBe(4);
  });

  it('orderClockwise は空席を飛ばして並べ替える', () => {
    expect(orderClockwise([0, 3, 7], 3, 10)).toEqual([3, 7, 0]);
    expect(orderClockwise([0, 3, 7], 8, 10)).toEqual([0, 3, 7]);
  });
});

describe('ブラインドの位置（3人以上）', () => {
  it('SB はディーラーの次、BB はその次、最初の行動は BB の次', () => {
    expect(blindPositions([0, 1, 2], 0, 10)).toEqual({
      smallBlindSeat: 1,
      bigBlindSeat: 2,
      firstToActSeat: 0,
    });
  });

  it('空席を飛ばして割り当てる', () => {
    // 席 0, 4, 9 に3人。ディーラーは 0。
    expect(blindPositions([0, 4, 9], 0, 10)).toEqual({
      smallBlindSeat: 4,
      bigBlindSeat: 9,
      firstToActSeat: 0,
    });
  });

  it('一周をまたぐ', () => {
    expect(blindPositions([0, 1, 9], 9, 10)).toEqual({
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      firstToActSeat: 9,
    });
  });

  it('4人ならディーラーは最初の行動者にならない', () => {
    const result = blindPositions([0, 1, 2, 3], 0, 10);
    expect(result).toEqual({ smallBlindSeat: 1, bigBlindSeat: 2, firstToActSeat: 3 });
  });
});

describe('ブラインドの位置（ヘッズアップ）', () => {
  /**
   * 2人のときは順序が逆転する。旧 poker-web-test は「BB の次から」と
   * 一律に計算していたため、2人プレイで必ず手番が狂っていた。
   */
  it('ディーラーが SB を出し、プリフロップはディーラーから始まる', () => {
    expect(blindPositions([0, 1], 0, 10)).toEqual({
      smallBlindSeat: 0,
      bigBlindSeat: 1,
      firstToActSeat: 0,
    });
  });

  it('ディーラーが逆側でも同じ規則', () => {
    expect(blindPositions([0, 1], 1, 10)).toEqual({
      smallBlindSeat: 1,
      bigBlindSeat: 0,
      firstToActSeat: 1,
    });
  });

  it('離れた席同士でも成立する', () => {
    expect(blindPositions([2, 7], 7, 10)).toEqual({
      smallBlindSeat: 7,
      bigBlindSeat: 2,
      firstToActSeat: 7,
    });
  });

  it('ディーラー位置が空席でも在席者に寄せる', () => {
    expect(blindPositions([3, 8], 0, 10)).toEqual({
      smallBlindSeat: 3,
      bigBlindSeat: 8,
      firstToActSeat: 3,
    });
  });

  it('1人以下では成立しない', () => {
    expect(blindPositions([0], 0, 10)).toBeNull();
    expect(blindPositions([], 0, 10)).toBeNull();
  });
});

describe('フロップ以降の開始位置', () => {
  it('人数にかかわらずディーラーの次', () => {
    expect(postflopFirstToActSeat([0, 1, 2], 0, 10)).toBe(1);
    expect(postflopFirstToActSeat([0, 4, 9], 9, 10)).toBe(0);
  });

  it('ヘッズアップでは BB 側が先に行動する', () => {
    // ディーラー（SB）が 0、BB が 1。フロップ以降は 1 から。
    expect(postflopFirstToActSeat([0, 1], 0, 10)).toBe(1);
  });
});
