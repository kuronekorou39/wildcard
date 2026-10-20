import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_CARD_APPEARANCE, parseCardAppearance, FACE_STYLES, BACK_STYLES } from '../src/cardAppearance.js';
import { PlayingCard } from '../src/components/PlayingCard.js';

describe('カード表示の保存設定', () => {
  it('有効な組み合わせを復元する', () => {
    expect(parseCardAppearance('{"face":"four-color","back":"monogram"}'))
      .toEqual({ face: 'four-color', back: 'monogram' });
  });

  it.each([null, '{invalid', 'null', '42', '"classic"', '[]'])('壊れた値 %s でも既定の表示で起動する', (value) => {
    expect(parseCardAppearance(value)).toEqual(DEFAULT_CARD_APPEARANCE);
  });

  it('片面が未知の設定でも、もう片面の選択を残す', () => {
    expect(parseCardAppearance('{"face":"old-style","back":"diamond"}'))
      .toEqual({ face: 'classic', back: 'diamond' });
    expect(parseCardAppearance('{"face":"bold","back":null}'))
      .toEqual({ face: 'bold', back: 'dragon' });
  });
});

describe('デザイン変更時のカードの意味', () => {
  it.each(FACE_STYLES)('$id でもカードの読み上げ名は一つで変わらない', ({ id }) => {
    const html = renderToStaticMarkup(<PlayingCard card={{ rank: '10', suit: 'diamonds' }} faceStyle={id} />);
    expect(html.match(/aria-label="10♦"/g)).toHaveLength(1);
    expect(html).not.toContain('card-back');
  });

  it.each(BACK_STYLES)('$id の裏面に数字やスートを描画しない', ({ id }) => {
    const html = renderToStaticMarkup(<PlayingCard card={null} backStyle={id} />);
    expect(html).toContain('aria-label="裏向きのカード"');
    expect(html).not.toContain('card-index');
    expect(html).not.toContain('card-rank');
    expect(html).not.toContain('card-suit');
  });

  it.each(FACE_STYLES)('$id でもジョーカーを通常札と区別できる', ({ id }) => {
    const html = renderToStaticMarkup(<PlayingCard card={{ rank: 'A', suit: 'spades', joker: 0 }} faceStyle={id} />);
    expect(html).toContain('aria-label="JOKER"');
    expect(html).toContain('card-joker');
    expect(html).not.toContain('card-index');
  });
});
