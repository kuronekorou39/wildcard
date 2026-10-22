import { useSyncExternalStore } from 'react';

export type SoundName = 'deal' | 'board' | 'fold' | 'bet' | 'raise' | 'win' | 'check' | 'turn' | 'tick' | 'urgent';
export interface SoundSettings { readonly muted: boolean; readonly effects: number; readonly music: number }
const DEFAULTS: SoundSettings = { muted: false, effects: .55, music: .16 };
const KEY = 'wildcard.sound.v1';
export function parseSoundSettings(value: unknown): SoundSettings {
  const raw = value as Partial<SoundSettings> | null;
  const volume = (n: unknown, fallback: number) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  return { muted: typeof raw?.muted === 'boolean' ? raw.muted : false,
    effects: volume(raw?.effects, DEFAULTS.effects), music: volume(raw?.music, DEFAULTS.music) };
}
function readSettings() {
  try { return parseSoundSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return DEFAULTS; }
}
let settings = readSettings();
const listeners = new Set<() => void>();
export function setSoundSettings(change: Partial<SoundSettings>) {
  settings = parseSoundSettings({ ...settings, ...change });
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
  tableAudio.sync();
  listeners.forEach(listener => listener());
}
export function useSoundSettings() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => settings, () => DEFAULTS);
}
const asset = (name: string) => `${import.meta.env.BASE_URL}audio/${name}.mp3${name === 'check' ? '?v=knocks' : ''}`;

/** One audio graph per browser tab. Playback never controls the poker state. */
class TableAudio {
  private context: AudioContext | null = null;
  private effects: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private buffers = new Map<SoundName, Promise<AudioBuffer | null>>();
  private sources = new Set<AudioBufferSourceNode>();
  private active = 0;
  private generation = 0;

  async unlock() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.effects = this.context.createGain(); this.effects.gain.value = 0; this.effects.connect(this.context.destination);
        this.musicGain = this.context.createGain(); this.musicGain.gain.value = 0; this.musicGain.connect(this.context.destination);
        this.music = new Audio(asset('lounge')); this.music.loop = true; this.music.preload = 'none';
        this.context.createMediaElementSource(this.music).connect(this.musicGain);
      }
      const resumed = this.context.state !== 'running' ? this.context.resume() : Promise.resolve();
      // Start the media element inside the gesture too, including on mobile Safari.
      if (this.active && !document.hidden && !settings.muted && settings.music > 0) void this.music?.play().catch(() => {});
      await resumed;
      this.sync();
      if (this.active) for (const name of ['deal', 'board', 'fold', 'bet', 'raise', 'win', 'check', 'turn', 'tick', 'urgent'] as const) void this.buffer(name);
    } catch { /* A blocked or unavailable audio device does not block the game. */ }
  }
  attach() {
    this.active++;
    const unlock = () => { void this.unlock(); };
    const visibility = () => { this.stopEffects(); this.sync(); };
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', visibility);
    if (navigator.userActivation?.hasBeenActive) void this.unlock();
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', visibility);
      this.active--;
      this.stopEffects(); this.sync();
    };
  }
  sync() {
    if (!this.context) return;
    const audible = this.active > 0 && !document.hidden && !settings.muted;
    this.effects?.gain.setTargetAtTime(audible ? settings.effects : 0, this.context.currentTime, .025);
    this.musicGain?.gain.setTargetAtTime(audible ? settings.music : 0, this.context.currentTime, .08);
    if (audible && settings.music > 0 && this.context.state === 'running') void this.music?.play().catch(() => {});
    else this.music?.pause();
    if (!audible || settings.effects === 0) this.stopEffects();
  }
  private buffer(name: SoundName) {
    if (!this.buffers.has(name) && (name === 'turn' || name === 'tick' || name === 'urgent')) {
      // Short original notification tones, kept in the same gain/mute graph as the recorded effects.
      const duration = name === 'turn' ? .48 : name === 'urgent' ? .16 : .09;
      const buffer = this.context!.createBuffer(1, Math.ceil(this.context!.sampleRate * duration), this.context!.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / buffer.sampleRate;
        const second = name === 'turn' && t >= .19;
        const elapsed = second ? t - .19 : t;
        const frequency = name === 'turn' ? (second ? 880 : 660) : name === 'urgent' ? 1046 : 784;
        const envelope = Math.min(1, elapsed / .008) * Math.exp(-elapsed * (name === 'turn' ? 15 : 35)) * Math.min(1, (duration - t) / .015);
        data[i] = .3 * envelope * (Math.sin(2 * Math.PI * frequency * elapsed) + .15 * Math.sin(4 * Math.PI * frequency * elapsed));
      }
      this.buffers.set(name, Promise.resolve(buffer));
    }
    if (!this.buffers.has(name)) this.buffers.set(name, fetch(asset(name)).then(response => {
      if (!response.ok) throw new Error('Audio unavailable');
      return response.arrayBuffer();
    }).then(data => this.context!.decodeAudioData(data)).catch(() => { this.buffers.delete(name); return null; }));
    return this.buffers.get(name)!;
  }
  async play(name: SoundName, gain = 1, at = Date.now()) {
    const generation = this.generation;
    if (!this.context || !this.active || settings.muted || settings.effects === 0 || document.hidden) return;
    const buffer = await this.buffer(name);
    if (!buffer || !this.effects || generation !== this.generation || Date.now() - at > 250 || this.context.state !== 'running') return;
    // Dense deals stay quiet, and voices cannot accumulate without bound.
    if (this.sources.size >= 12) return;
    const source = this.context.createBufferSource(); source.buffer = buffer;
    const level = this.context.createGain(); level.gain.value = gain;
    source.connect(level).connect(this.effects); this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); level.disconnect(); };
    source.start();
  }
  private stopEffects() {
    this.generation++;
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } }
    this.sources.clear();
  }
}
export const tableAudio = new TableAudio();
