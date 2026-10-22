import { describe, expect, it } from 'vitest';
import { createGame, project, reduce } from '@wildcard/engine';
import { parseSoundSettings } from '../src/audio.js';
import { soundCues, turnSoundCues } from '../src/hooks/useTableAudio.js';
import { LocalTransport } from '../src/transport/local.js';
import type { TableSnapshot } from '../src/transport/types.js';

describe('サウンド', () => {
  it('壊れた保存値も安全な音量に戻す', () => {
    expect(parseSoundSettings({ effects: 3, music: -1, muted: 'no' })).toEqual({ effects: 1, music: 0, muted: false });
    expect(parseSoundSettings({ effects: NaN, music: Infinity })).toEqual(parseSoundSettings(null));
  });
  it('配牌・公開・ベット・レイズ・フォールド・配当を公開イベントの時刻に合わせる', () => {
    let state = createGame({ seatCount: 2 });
    for (let seat = 0; seat < 2; seat++) state = reduce(state, { type: 'sit', playerId: `p${seat}`, name: 'P', seat, chips: 1000 });
    state = reduce(state, { type: 'startHand', seed: 2 });
    const snapshot: TableSnapshot = { state: project(state, 'p0'), viewerId: 'p0', status: 'local', note: null,
      runtime: { handId: 1, handStartedAt: 1000, readyAt: 5000, nextHandAt: null, clock: null, potChips: [], bets: [], events: [
        { kind: 'deal', id: 1, at: 1000 }, { kind: 'burn', id: 2, count: 1, at: 2000 },
        { kind: 'board', id: 3, at: 3000, run: 0, from: 0, count: 3 },
        { kind: 'bet', id: 4, at: 4000, playerId: 'p0', amount: 10 },
        { kind: 'bet', id: 5, at: 5000, playerId: 'p0', amount: 40, raised: true },
        { kind: 'fold', id: 6, at: 6000, playerId: 'p0' },
        { kind: 'win', id: 7, at: 7000, playerId: 'p1', amount: 100 },
      ] } };
    const cues = soundCues(snapshot);
    expect(cues.filter(c => c.key.startsWith('1:1:')).map(c => c.at)).toEqual([1000, 1044, 1088, 1132]);
    expect(cues.filter(c => c.sound === 'board').map(c => c.at)).toEqual([3000, 3180, 3360]);
    expect(cues.slice(-4).map(c => c.sound)).toEqual(['bet', 'raise', 'fold', 'win']);
    expect(cues.at(-1)?.at).toBe(7910);
    expect(new Set(cues.map(c => c.key)).size).toBe(cues.length);
    expect(JSON.stringify(cues)).not.toMatch(/rank|suit|holeCards/);
  });
  it('実際に成立したレイズだけを区別する', () => {
    const transport = new LocalTransport({ seatCount: 2, viewer: { kind: 'fixed', playerId: 'p0' }, setup: [
      { type: 'sit', playerId: 'p0', seat: 0, name: 'P0', chips: 1000 },
      { type: 'sit', playerId: 'p1', seat: 1, name: 'P1', chips: 1000 },
    ] });
    transport.dispatch({ type: 'startHand', seed: 2 });
    const playerId = transport.rawState().turnPlayerId!;
    transport.dispatch({ type: 'raise', playerId, to: 100000 });
    expect(soundCues(transport.snapshot()).some(c => c.sound === 'raise')).toBe(false);
    transport.dispatch({ type: 'raise', playerId, to: 100 });
    expect(soundCues(transport.snapshot()).filter(c => c.sound === 'raise')).toHaveLength(1);
    transport.dispose();
  });
  it('成立したチェックを鳴らし、拒否されたチェックでは鳴らさない', () => {
    const transport = new LocalTransport({ seatCount: 2, viewer: { kind: 'fixed', playerId: 'p0' }, setup: [
      { type: 'sit', playerId: 'p0', seat: 0, name: 'P0', chips: 1000 },
      { type: 'sit', playerId: 'p1', seat: 1, name: 'P1', chips: 1000 },
    ] });
    transport.dispatch({ type: 'startHand', seed: 2 });
    transport.dispatch({ type: 'check', playerId: transport.rawState().turnPlayerId! });
    expect(soundCues(transport.snapshot()).filter(c => c.sound === 'check')).toHaveLength(0);
    transport.dispatch({ type: 'call', playerId: transport.rawState().turnPlayerId! });
    transport.dispatch({ type: 'check', playerId: transport.rawState().turnPlayerId! });
    expect(soundCues(transport.snapshot()).filter(c => c.sound === 'check')).toHaveLength(1);
    transport.dispose();
  });
  it('自分の手番開始と最後の5秒だけを予約し、目隠し・観戦・切断中には鳴らさない', () => {
    const state = { ...project(createGame({ seatCount: 2 }), 'p0'), turnPlayerId: 'p0' };
    const snapshot: TableSnapshot = { state, viewerId: 'p0', status: 'local', note: null, runtime: {
      handId: 1, handStartedAt: 0, readyAt: 1000, nextHandAt: null, events: [], potChips: [], bets: [],
      clock: { id: 2, playerId: 'p0', durationMs: 30000, startedAt: 1000, deadline: 31000 },
    } };
    expect(turnSoundCues(snapshot).map(c => [c.at, c.sound])).toEqual([
      [1000, 'turn'], [26000, 'tick'], [27000, 'tick'], [28000, 'tick'], [29000, 'tick'], [30000, 'urgent'],
    ]);
    expect(turnSoundCues({ ...snapshot, viewerId: 'p1' })).toEqual([]);
    expect(turnSoundCues({ ...snapshot, viewerId: null })).toEqual([]);
    expect(turnSoundCues({ ...snapshot, status: 'disconnected' })).toEqual([]);
    expect(turnSoundCues({ ...snapshot, runtime: { ...snapshot.runtime!, clock: { ...snapshot.runtime!.clock!, startedAt: null, deadline: null } } })).toEqual([]);
  });
});
