import { describe, expect, it } from 'vitest';
import { createGame, project, reduce } from '@wildcard/engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { tablePositions, TablePositionMarkers } from '../src/components/TablePositionMarkers.js';
import { SoloTable } from '../src/modes/SoloTable.js';

function table(seats: number[]) {
  let state = createGame({ seatCount: 10, smallBlind: 10, bigBlind: 20, dealerSeat: seats[0]! });
  for (const seat of seats)
    state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: `Player ${seat}`, seat, chips: 1000 });
  return state;
}

describe('卓上のディーラーとブラインド', () => {
  it('開始前はまだブラインドを表示しない', () => {
    expect(tablePositions(project(table([0, 3, 8]), 'p0'))).toBeNull();
  });
  it('空席のあるヘッズアップでもディーラーがSBを兼ねる', () => {
    const state = project(reduce(table([2, 7]), { type: 'startHand', seed: 7 }), 'p2');
    expect(tablePositions(state)).toEqual({ smallBlindSeat: 2, bigBlindSeat: 7, firstToActSeat: 2 });
    const html = renderToStaticMarkup(<TablePositionMarkers state={state} viewerSeat={2} />);
    expect(html.match(/position-d"/g)).toHaveLength(1);
    expect(html.match(/position-sb"/g)).toHaveLength(1);
    expect(html.match(/position-bb"/g)).toHaveLength(1);
    expect(html).toContain('ディーラー：Player 2');
    expect(html).toContain('スモールブラインド：Player 2');
  });
  it('離席者を除外し、フォールドしてもSB/BBを別の人に移さない', () => {
    let state = table([0, 3, 5, 8]);
    state = reduce(state, { type: 'setAway', playerId: 'p5', away: true });
    state = reduce(state, { type: 'startHand', seed: 4 });
    state = reduce(state, { type: 'call', playerId: 'p0' });
    state = reduce(state, { type: 'fold', playerId: 'p3' });
    expect(state.players.find(p => p.id === 'p3')?.folded).toBe(true);
    expect(tablePositions(project(state, 'p0'))).toEqual({ smallBlindSeat: 3, bigBlindSeat: 8, firstToActSeat: 0 });
  });
  it('決着後も表示を保ち、次のハンドではボタンとブラインドが移動する', () => {
    let state = reduce(table([0, 3, 8]), { type: 'startHand', seed: 8 });
    state = reduce(state, { type: 'fold', playerId: 'p0' });
    state = reduce(state, { type: 'fold', playerId: 'p3' });
    expect(state.phase).toBe('showdown');
    expect(tablePositions(project(state, 'p0'))?.smallBlindSeat).toBe(3);
    state = reduce(state, { type: 'startHand', seed: 9 });
    expect(state.dealerSeat).toBe(3);
    expect(tablePositions(project(state, 'p0'))).toEqual({ smallBlindSeat: 8, bigBlindSeat: 0, firstToActSeat: 3 });
  });
});

it('ソロはCPU9人と自分の10席を用意できる', () => {
  const html = renderToStaticMarkup(<SoloTable settings={{
    name: 'あなた', opponents: 9, chips: 1000, smallBlind: 10, bigBlind: 20, variantId: 'standard', aggression: .5,
  }} onExit={() => {}} />);
  expect(html.match(/class="seat[ "]/g)).toHaveLength(10);
  expect(html).toContain('CPU9');
  expect(html).toContain('ゲーム開始');
});
