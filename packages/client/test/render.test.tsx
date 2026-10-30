import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createGame, project, reduce } from '@wildcard/engine';
import { HandSummaryPanel } from '../src/components/HandSummaryPanel.js';
import { App } from '../src/App.js';
import { SoloTable } from '../src/modes/SoloTable.js';

/**
 * ブラウザを立てずに描画が通ることだけを確かめる煙テスト。
 * 操作の筋は local.test.ts が Transport 越しに見ているので、
 * ここでは「落ちない」「出すべきものが出ている」「出してはいけないものが出ていない」を見る。
 */

const settings = {
  name: 'あかり',
  opponents: 2,
  aggression: 0.5,
  chips: 1000,
  smallBlind: 10,
  bigBlind: 20,
  variantId: 'standard',
};

describe('描画', () => {
  it('最初の画面が描画できる', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Wildcard');
    expect(html).toContain('ソロ');
    expect(html).toContain('オンライン');
    expect(html).not.toContain('ホットシート');
  });

  it('卓の画面が描画できる', () => {
    const html = renderToStaticMarkup(<SoloTable settings={settings} onExit={() => {}} />);

    // 全員の名前が席に出ている
    for (const name of [settings.name, 'CPU1', 'CPU2']) expect(html).toContain(name);
    // まだ開始前なのでポットは0
    expect(html).toContain('data-collected="0" data-pending="0"');
    expect(html).toContain('<span class="pot-value">0</span>');
    expect(html).toContain('ゲーム開始');
  });

  it('人数ぶんの席が描画される', () => {
    const html = renderToStaticMarkup(<SoloTable settings={settings} onExit={() => {}} />);
    // 3人なので seatCount は3、空席は出ない
    expect(html.match(/class="seat[ "]/g) ?? []).toHaveLength(3);
  });

  it('ソロでは人数ぶんの席しか作らないので空席が出ない', () => {
    const html = renderToStaticMarkup(
      <SoloTable settings={{ ...settings, opponents: 1 }} onExit={() => {}} />,
    );
    expect(html).not.toContain('空席');
    expect(html.match(/class="seat[ "]/g) ?? []).toHaveLength(2);
  });

  it('コミュニティカードの枠が5つ出る', () => {
    const html = renderToStaticMarkup(<SoloTable settings={settings} onExit={() => {}} />);
    expect(html.match(/card-slot/g) ?? []).toHaveLength(5);
  });
});

describe('ハンド終了の表示', () => {
  /** 途中で流れたハンドの状態を作る。 */
  function foldedOut(variantOptions: { rabbitHunt?: boolean }) {
    let state = createGame({
      seatCount: 3,
      smallBlind: 10,
      bigBlind: 20,
      variant: {
        ...createGame().variant,
        id: 'test',
        options: variantOptions,
      },
    });
    for (let i = 0; i < 3; i++) {
      state = reduce(state, { type: 'sit', playerId: `p${i}`, name: `p${i}`, seat: i, chips: 1000 });
    }
    state = reduce(state, { type: 'startHand', seed: 1 });
    let guard = 0;
    while (state.phase === 'betting' && guard++ < 10) {
      state = reduce(state, { type: 'fold', playerId: state.turnPlayerId! });
    }
    return project(state, 'p0');
  }

  const panel = (state: ReturnType<typeof foldedOut>) =>
    renderToStaticMarkup(
      <HandSummaryPanel
        state={state}
        onNextHand={() => {}}
        canStartNextHand
        blockedReason={null}
      />,
    );

  it('ラビットハントが無効なら「配られるはずだった札」は出ない', () => {
    expect(panel(foldedOut({}))).not.toContain('配られるはずだった札');
  });

  it('ラビットハントが有効なら残りの札が出る', () => {
    const state = foldedOut({ rabbitHunt: true });
    expect(state.summary!.rabbit).toHaveLength(5);

    const html = panel(state);
    expect(html).toContain('配られるはずだった札');
    // フロップ3 + ターン1 + リバー1 の5枚が並ぶ
    expect(html.match(/summary-rabbit-cards/g) ?? []).toHaveLength(1);
    for (const card of state.summary!.rabbit) {
      expect(html).toContain(`${card.rank}`);
    }
  });
});
