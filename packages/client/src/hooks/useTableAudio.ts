import { useEffect, useRef } from 'react';
import { tableAudio, type SoundName } from '../audio.js';
import { TABLE_TIMING as T } from '../transport/presentation.js';
import type { TableSnapshot } from '../transport/types.js';

export interface SoundCue { readonly key: string; readonly at: number; readonly sound: SoundName; readonly gain: number }
/** Only public presentation events are sonified; cards' values are never inspected. */
export function soundCues(snapshot: TableSnapshot): SoundCue[] {
  const cues: SoundCue[] = [];
  for (const event of snapshot.runtime?.events ?? []) {
    const add = (sound: SoundName, offset = 0, gain = .65, suffix = '') =>
      cues.push({ key: `${snapshot.runtime!.handId}:${event.id}:${suffix}`, at: event.at + offset, sound, gain });
    if (event.kind === 'deal') {
      const count = Math.max(0, ...snapshot.state.players.map(p => p.holeCards.length)) * snapshot.state.seatCount;
      for (let i = 0; i < count; i++) add('deal', i * T.dealGap, .2, String(i));
    } else if (event.kind === 'board') {
      for (let i = 0; i < event.count; i++) add('board', i * T.boardGap, .4, String(i));
    } else if (event.kind === 'burn') add('deal', 0, .25);
    else if (event.kind === 'fold') add('fold', 0, .4);
    else if (event.kind === 'bet') add(event.raised ? 'raise' : 'bet');
    else if (event.kind === 'win') add('win', T.win * .7, .75);
  }
  return cues;
}
export function useTableAudio(snapshot: TableSnapshot) {
  const seen = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const hand = useRef(-1);
  useEffect(() => {
    const detach = tableAudio.attach();
    return () => { timers.current.forEach(clearTimeout); timers.current.clear(); seen.current.clear(); detach(); };
  }, []);
  useEffect(() => {
    if (hand.current !== snapshot.runtime?.handId) {
      timers.current.forEach(clearTimeout); timers.current.clear(); seen.current.clear();
      hand.current = snapshot.runtime?.handId ?? -1;
    }
    const cues = soundCues(snapshot);
    const live = new Set(cues.map(c => c.key));
    for (const key of seen.current) if (!live.has(key)) seen.current.delete(key);
    for (const cue of cues) {
      if (seen.current.has(cue.key)) continue;
      seen.current.add(cue.key);
      if (Date.now() - cue.at > 250) continue;
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        void tableAudio.play(cue.sound, cue.gain, cue.at);
      }, Math.max(0, cue.at - Date.now()));
      timers.current.add(timer);
    }
  }, [snapshot]);
}
