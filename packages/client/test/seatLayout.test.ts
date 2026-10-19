import { describe, expect, it } from 'vitest';
import { displaySlot, seatPosition } from '../src/seatLayout.js';

describe('自席を手前に回す（displaySlot）', () => {
  it('見ている本人は必ずスロット0（画面手前の中央）に来る', () => {
    for (const viewerSeat of [0, 1, 5, 9]) {
      expect(displaySlot(viewerSeat, viewerSeat, 10)).toBe(0);
    }
  });

  it('自席より後ろの席は時計回りに並ぶ', () => {
    // 自分が席7なら、席8は1つ隣、席9は2つ隣、席0は3つ隣
    expect(displaySlot(8, 7, 10)).toBe(1);
    expect(displaySlot(9, 7, 10)).toBe(2);
    expect(displaySlot(0, 7, 10)).toBe(3);
  });

  it('席の並び順は保たれる（相対位置が崩れない）', () => {
    const seats = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const slots = seats.map((seat) => displaySlot(seat, 4, 10));
    // すべてのスロットが1回ずつ使われる
    expect([...slots].sort((a, b) => a - b)).toEqual(seats);
  });

  it('観戦者は席番号そのままで並べる', () => {
    expect(displaySlot(3, null, 10)).toBe(3);
    expect(displaySlot(9, null, 10)).toBe(9);
  });

  it('席数が変わっても成立する', () => {
    expect(displaySlot(0, 2, 3)).toBe(1);
    expect(displaySlot(1, 2, 3)).toBe(2);
    expect(displaySlot(2, 2, 3)).toBe(0);
  });
});

describe('楕円上の座席位置（seatPosition）', () => {
  const close = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 5);

  it('スロット0は真下（手前の中央）', () => {
    const { left, top } = seatPosition(0, 10);
    close(left, 50);
    close(top, 100);
  });

  it('席数が偶数なら、ちょうど向かいのスロットは真上に来る', () => {
    const { left, top } = seatPosition(5, 10);
    close(left, 50);
    close(top, 0);
  });

  it('スロットが増えると時計回りに進む（まず画面左へ）', () => {
    const first = seatPosition(1, 10);
    const quarter = seatPosition(2.5, 10);
    // 真下から時計回り = 左下 -> 左
    expect(first.left).toBeLessThan(50);
    expect(first.top).toBeGreaterThan(50);
    close(quarter.left, 0);
    close(quarter.top, 50);
  });

  it('後半のスロットは画面右側に来る', () => {
    const { left, top } = seatPosition(7.5, 10);
    close(left, 100);
    close(top, 50);
  });

  it('全スロットが楕円の上に乗る', () => {
    for (let slot = 0; slot < 10; slot++) {
      const { left, top } = seatPosition(slot, 10);
      const dx = (left - 50) / 50;
      const dy = (top - 50) / 50;
      close(dx * dx + dy * dy, 1);
    }
  });
});
