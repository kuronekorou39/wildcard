import { describe, expect, it } from 'vitest';
import { JOKER_WILD, STANDARD_VARIANT, evaluateHand, type Card, type Rank, type Suit, type Variant } from '@wildcard/engine';
import { describeHand } from '../src/handDescription.js';

const SUITS: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const cards = (text: string): Card[] => text.split(' ').map((t) => ({ rank: t.slice(0, -1) as Rank, suit: SUITS[t.slice(-1)]! }));
const JOKER: Card = { rank: 'A', suit: 'spades', joker: 0 };

describe('役の説明', () => {
  it('同じフォーカードどうしでも、キッカーとジョーカーの化け先で負けた理由が読める', () => {
    // 同じ札が何枚もあるデッキにジョーカー1枚。ファイブカードは役に無い（以前、引き分けに見えて負けた形）。
    const variant: Variant = { ...STANDARD_VARIANT, deck: { ...STANDARD_VARIANT.deck, copies: 6, jokers: 1 } };
    const board = cards('Qd Qd Qd Qd 4h');
    const me = describeHand(evaluateHand(cards('Qd Qc'), board, variant)!, variant);
    const cpu = describeHand(evaluateHand([cards('Qd')[0]!, JOKER], board, variant)!, variant);
    expect(me).toEqual({ main: 'フォーカード（Q）', detail: 'キッカー Q' });
    expect(cpu).toEqual({ main: 'フォーカード（Q）', detail: 'キッカー A · ジョーカー→A' });
  });

  it('フルハウスは3枚のほうを先に、ツーペアは強いほうを先に書く', () => {
    expect(describeHand(evaluateHand(cards('7s 7h'), cards('Kd Kc 7c 2s 3h'), STANDARD_VARIANT)!, STANDARD_VARIANT).main).toBe('フルハウス（7・K）');
    const twoPair = describeHand(evaluateHand(cards('7s 7h'), cards('Kd Kc 9c 2s 3h'), STANDARD_VARIANT)!, STANDARD_VARIANT);
    expect(twoPair).toEqual({ main: 'ツーペア（K・7）', detail: 'キッカー 9' });
  });

  it('ハイカードは一番上の札と残りを書き、ストレートやフラッシュは名前だけ', () => {
    expect(describeHand(evaluateHand(cards('As 9h'), cards('Kd 7c 4c 2s 3h'), STANDARD_VARIANT)!, STANDARD_VARIANT))
      .toEqual({ main: 'ハイカード（A）', detail: 'キッカー K・9・7・4' });
    expect(describeHand(evaluateHand(cards('9s 8h'), cards('7d 6c 5c 2s 2h'), STANDARD_VARIANT)!, STANDARD_VARIANT))
      .toEqual({ main: 'ストレート', detail: '' });
  });

  it('スートを見る役では、ジョーカーの化け先にスートも書く', () => {
    const result = evaluateHand([JOKER, ...cards('Ks')], cards('Qs Js 10s 2d 3c'), JOKER_WILD)!;
    expect(describeHand(result, JOKER_WILD).detail).toBe('ジョーカー→A♠');
  });
});
