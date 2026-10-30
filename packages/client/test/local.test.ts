import { describe, expect, it } from 'vitest';
import type { Action } from '@wildcard/engine';
import { LocalTransport } from '../src/transport/local.js';

const sit = (i: number, seat: number, chips = 1000): Action => ({
  type: 'sit',
  playerId: `p${i}`,
  name: `p${i}`,
  seat,
  chips,
});

const hotSeat = () =>
  new LocalTransport({
    seatCount: 10,
    smallBlind: 10,
    bigBlind: 20,
    viewer: { kind: 'followTurn' },
    setup: [sit(0, 0), sit(1, 1), sit(2, 2)],
  });

describe('LocalTransport の基本', () => {
  it('setup のアクションが適用された状態から始まる', () => {
    const { state } = hotSeat().snapshot();
    expect(state.players).toHaveLength(3);
    expect(state.phase).toBe('waiting');
  });

  it('同じ状態なら snapshot は同一オブジェクトを返す', () => {
    // useSyncExternalStore は Object.is で変化を見るため、ここが崩れると
    // 無限に再レンダリングし続ける。
    const transport = hotSeat();
    expect(transport.snapshot()).toBe(transport.snapshot());
  });

  it('状態が変わると snapshot も変わる', () => {
    const transport = hotSeat();
    const before = transport.snapshot();
    transport.dispatch({ type: 'startHand', seed: 1 });
    expect(transport.snapshot()).not.toBe(before);
  });

  it('不正なアクションでは購読者に通知しない', () => {
    const transport = hotSeat();
    let calls = 0;
    transport.subscribe(() => calls++);

    // 手番ではない人の行動は拒否される
    transport.dispatch({ type: 'fold', playerId: 'p0' });
    expect(calls).toBe(0);

    transport.dispatch({ type: 'startHand', seed: 1 });
    expect(calls).toBe(1);
  });

  it('購読を解除できる', () => {
    const transport = hotSeat();
    let calls = 0;
    const unsubscribe = transport.subscribe(() => calls++);
    transport.dispatch({ type: 'startHand', seed: 1 });
    unsubscribe();
    transport.dispatch({ type: 'fold', playerId: transport.rawState().turnPlayerId! });
    expect(calls).toBe(1);
  });
});

describe('手番視点の秘匿（内部検証用 followTurn）', () => {
  it('視点が手番とともに移る', () => {
    const transport = hotSeat();
    transport.dispatch({ type: 'startHand', seed: 1 });

    // 3人、ディーラー席0 なので最初の手番は席0（BBの次）
    expect(transport.snapshot().viewerId).toBe('p0');

    transport.dispatch({ type: 'call', playerId: 'p0' });
    expect(transport.snapshot().viewerId).toBe('p1');
  });

  it('見えるホールカードは手番の人のものだけ', () => {
    const transport = hotSeat();
    transport.dispatch({ type: 'startHand', seed: 1 });

    const { state, viewerId } = transport.snapshot();
    for (const player of state.players) {
      if (player.id === viewerId) {
        expect(player.holeCards, `${player.id} は自分なので見える`).toHaveLength(2);
      } else {
        // 見えない札は null。長さは実際の枚数なので、何枚持っているかは分かる。
        expect(player.holeCards, `${player.id} は他人なので見えない`).toEqual([null, null]);
      }
    }
  });

  it('山札は UI に一切渡らない', () => {
    const transport = hotSeat();
    transport.dispatch({ type: 'startHand', seed: 1 });
    const { state } = transport.snapshot();

    expect(state).not.toHaveProperty('deck');
    expect(state.deckCount).toBe(52 - 6);
  });

  it('UI に渡るカードは見えてよいものだけ', () => {
    const transport = hotSeat();
    transport.dispatch({ type: 'startHand', seed: 1 });

    // カードオブジェクトは必ず "suit":"..." を持つ。ルール定義側の "suits":[...]
    // とは別物なので、これを数えれば実際のカードの枚数が分かる。
    const countCards = () =>
      (JSON.stringify(transport.snapshot().state).match(/"suit":"/g) ?? []).length;

    // プリフロップ: 手番の人のホールカード2枚だけ
    expect(countCards()).toBe(2);

    transport.dispatch({ type: 'call', playerId: 'p0' });
    transport.dispatch({ type: 'call', playerId: 'p1' });
    transport.dispatch({ type: 'check', playerId: 'p2' });

    // フロップ: 手番の人の2枚 + 場の3枚
    expect(transport.snapshot().state.streetIndex).toBe(0); // フロップ
    expect(countCards()).toBe(2 + 3);
  });

  it('ショーダウンでは公開された手が全員ぶん見える', () => {
    const transport = hotSeat();
    transport.dispatch({ type: 'startHand', seed: 1 });

    // 2人をオールインさせて決着させる
    transport.dispatch({ type: 'raise', playerId: 'p0', to: 1000 });
    transport.dispatch({ type: 'fold', playerId: 'p1' });
    transport.dispatch({ type: 'call', playerId: 'p2' });

    const { state } = transport.snapshot();
    expect(state.phase).toBe('showdown');
    expect(state.summary?.revealed).toHaveLength(2);

    const revealedIds = new Set(state.summary!.revealed.map((r) => r.playerId));
    for (const player of state.players) {
      if (revealedIds.has(player.id)) {
        expect(player.holeCards, `${player.id} は公開された`).toHaveLength(2);
      } else {
        expect(player.holeCards, `${player.id} は降りたので非公開`).toEqual([null, null]);
      }
    }
  });
});

describe('ソロの視点（fixed）', () => {
  it('手番が動いても視点は固定される', () => {
    const transport = new LocalTransport({
      seatCount: 10,
      smallBlind: 10,
      bigBlind: 20,
      viewer: { kind: 'fixed', playerId: 'p0' },
      setup: [sit(0, 0), sit(1, 1), sit(2, 2)],
    });

    transport.dispatch({ type: 'startHand', seed: 1 });
    expect(transport.snapshot().viewerId).toBe('p0');

    transport.dispatch({ type: 'call', playerId: 'p0' });
    expect(transport.snapshot().state.turnPlayerId).toBe('p1');
    expect(transport.snapshot().viewerId).toBe('p0');

    // 相手の手番になっても相手のカードは見えない
    const p1 = transport.snapshot().state.players.find((p) => p.id === 'p1')!;
    expect(p1.holeCards).toEqual([null, null]);
  });
});
