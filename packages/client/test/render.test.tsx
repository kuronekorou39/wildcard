import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App.js';
import { HotSeatTable } from '../src/modes/HotSeatTable.js';

/**
 * ブラウザを立てずに描画が通ることだけを確かめる煙テスト。
 * 操作の筋は local.test.ts が Transport 越しに見ているので、
 * ここでは「落ちない」「出すべきものが出ている」「出してはいけないものが出ていない」を見る。
 */

const settings = {
  names: ['あかり', 'ばしょう', 'ちとせ'],
  chips: 1000,
  smallBlind: 10,
  bigBlind: 20,
  ruleSetId: 'standard',
};

describe('描画', () => {
  it('最初の画面が描画できる', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Wildcard');
    expect(html).toContain('ホットシート');
  });

  it('卓の画面が描画できる', () => {
    const html = renderToStaticMarkup(<HotSeatTable settings={settings} onExit={() => {}} />);

    // 全員の名前が席に出ている
    for (const name of settings.names) expect(html).toContain(name);
    // まだ開始前なのでポットは0
    expect(html).toContain('ポット 0');
    expect(html).toContain('ゲーム開始');
  });

  it('人数ぶんの席が描画される', () => {
    const html = renderToStaticMarkup(<HotSeatTable settings={settings} onExit={() => {}} />);
    // 3人なので seatCount は3、空席は出ない
    expect(html.match(/class="seat[ "]/g) ?? []).toHaveLength(3);
  });

  it('ホットシートでは人数ぶんの席しか作らないので空席が出ない', () => {
    const html = renderToStaticMarkup(
      <HotSeatTable settings={{ ...settings, names: ['あかり', 'ばしょう'] }} onExit={() => {}} />,
    );
    expect(html).not.toContain('空席');
    expect(html.match(/class="seat[ "]/g) ?? []).toHaveLength(2);
  });

  it('コミュニティカードの枠が5つ出る', () => {
    const html = renderToStaticMarkup(<HotSeatTable settings={settings} onExit={() => {}} />);
    expect(html.match(/card-slot/g) ?? []).toHaveLength(5);
  });
});
