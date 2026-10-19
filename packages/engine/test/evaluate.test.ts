import { describe, expect, it } from 'vitest';
import { compareHands, evaluateBest } from '../src/rules/evaluate.js';
import { STANDARD_VARIANT } from '../src/rules/presets.js';
import { cards } from './helpers.js';

/**
 * エンジンは「フラッシュ」「ストレート」を一切知らない。
 * ここで検証しているのは、汎用のパターンマッチャが
 * STANDARD_VARIANT というデータから標準ポーカーを正しく再現できること。
 */
function hand(notation: string) {
  const result = evaluateBest(cards(notation), STANDARD_VARIANT);
  if (!result) throw new Error(`役が成立しなかった: ${notation}`);
  return result;
}

describe('標準の役が正しく判定される（7枚から最強の5枚を選ぶ）', () => {
  const expectations: ReadonlyArray<readonly [string, string, string]> = [
    ['ロイヤルフラッシュ', 'As Ks Qs Js Ts 2h 3d', 'royal_flush'],
    ['ストレートフラッシュ', '9s 8s 7s 6s 5s 2h 3d', 'straight_flush'],
    ['ストレートフラッシュ（ホイール）', 'As 2s 3s 4s 5s Kh Qd', 'steel_wheel'],
    ['フォーカード', 'As Ah Ad Ac Kh 2s 3d', 'four_of_a_kind'],
    ['フルハウス', 'As Ah Ad Kc Kh 2s 3d', 'full_house'],
    ['フラッシュ', 'As Ks Qs Js 9s 2h 3d', 'flush'],
    ['ストレート', '9h 8s 7d 6c 5s 2h Kd', 'straight'],
    ['ストレート（ホイール）', 'Ah 2s 3d 4c 5s Kd Qh', 'wheel'],
    ['スリーカード', 'As Ah Ad Kc Qh 2s 3d', 'three_of_a_kind'],
    ['ツーペア', 'As Ah Kd Kc 2s 7h 9c', 'two_pair'],
    ['ワンペア', 'As Ah Kc Qh 9s 3d 2c', 'one_pair'],
    ['ハイカード', 'As Kh Qd 9c 7s 3d 2h', 'high_card'],
  ];

  for (const [label, notation, expectedId] of expectations) {
    it(label, () => {
      expect(hand(notation).rankingId).toBe(expectedId);
    });
  }
});

describe('役の強さの序列', () => {
  it('ロイヤル > 通常のストレートフラッシュ > ホイールのストレートフラッシュ', () => {
    const royal = hand('As Ks Qs Js Ts');
    const normal = hand('9s 8s 7s 6s 5s');
    const steel = hand('As 2s 3s 4s 5s');
    expect(compareHands(royal, normal)).toBeGreaterThan(0);
    expect(compareHands(normal, steel)).toBeGreaterThan(0);
  });

  it('ホイールは最弱のストレートだが、スリーカードより強い', () => {
    const wheel = hand('Ah 2s 3d 4c 5s');
    const sixHigh = hand('2h 3s 4d 5c 6s');
    const trips = hand('As Ah Ad Kc Qh');
    expect(compareHands(sixHigh, wheel)).toBeGreaterThan(0);
    expect(compareHands(wheel, trips)).toBeGreaterThan(0);
  });

  it('フルハウスはフラッシュより強い', () => {
    expect(compareHands(hand('As Ah Ad Kc Kh'), hand('As Ks Qs Js 9s'))).toBeGreaterThan(0);
  });
});

describe('同じ役同士の比較（キッカー処理）', () => {
  it('ペアのランクが高いほうが勝つ', () => {
    expect(compareHands(hand('As Ah 5c 3h 2s'), hand('Ks Kh Qc Jh Ts'))).toBeGreaterThan(0);
  });

  it('同じペアならキッカーで決まる', () => {
    expect(compareHands(hand('As Ah Kc 3h 2s'), hand('Ad Ac Qc 3h 2s'))).toBeGreaterThan(0);
  });

  it('同じペア・同じキッカーなら引き分け（チョップ）', () => {
    expect(compareHands(hand('As Ah Kc 3h 2s'), hand('Ad Ac Kd 3d 2d'))).toBe(0);
  });

  it('フルハウスはスリーカードのランクが優先される（ペアが強くても負ける）', () => {
    // KKK+22 と QQQ+AA。ペア単体なら AA のほうが強いが、スリーカードが優先。
    expect(compareHands(hand('Ks Kh Kd 2c 2s'), hand('Qs Qh Qd As Ah'))).toBeGreaterThan(0);
  });

  it('ツーペアは高いペアから順に比較される', () => {
    expect(compareHands(hand('As Ah 2c 2s 5d'), hand('Ks Kh Qc Qs 5d'))).toBeGreaterThan(0);
  });

  it('ストレートは一番高い札で決まる', () => {
    expect(compareHands(hand('Th 9s 8d 7c 6s'), hand('9h 8s 7d 6c 5s'))).toBeGreaterThan(0);
  });

  it('フラッシュは高い札から順に比較される', () => {
    expect(compareHands(hand('As Ks Qs Js 9s'), hand('Ah Kh Qh Jh 8h'))).toBeGreaterThan(0);
  });

  it('ハイカードは5枚すべてで比較される', () => {
    expect(compareHands(hand('As Kh Qd 9c 7s'), hand('As Kh Qd 9c 6s'))).toBeGreaterThan(0);
  });
});

describe('最強の5枚を7枚から選べている', () => {
  it('フラッシュとストレートが同時に見えているときフラッシュを選ぶ', () => {
    // 9s8s7s6s5s でストレートフラッシュ、さらに 4d で 9-high ストレートも見える
    expect(hand('9s 8s 7s 6s 5s 4d Kh').rankingId).toBe('straight_flush');
  });

  it('7枚のうち役に使う5枚だけを cards に持つ', () => {
    const result = hand('As Ah Ad Ac Kh 2s 3d');
    expect(result.cards).toHaveLength(5);
    expect(result.matched).toHaveLength(4);
    expect(result.kickers).toHaveLength(1);
    expect(result.kickers[0]?.rank).toBe('K');
  });

  it('5枚未満は判定できない', () => {
    expect(evaluateBest(cards('As Ah Kd Qc'), STANDARD_VARIANT)).toBeNull();
  });
});
