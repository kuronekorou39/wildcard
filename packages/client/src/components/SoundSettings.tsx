import { setSoundSettings, tableAudio, useSoundSettings } from '../audio.js';

export function SoundSettings() {
  const settings = useSoundSettings();
  return <div className="sound-settings">
    <label className="sound-mute"><span>ミュート</span><input type="checkbox" checked={settings.muted}
      onChange={event => { setSoundSettings({ muted: event.target.checked }); void tableAudio.unlock(); }} /></label>
    {(['effects', 'music'] as const).map(kind => <label className="sound-volume" key={kind} htmlFor={`sound-${kind}`}>
      <span>{kind === 'effects' ? '効果音' : 'BGM'}<output>{Math.round(settings[kind] * 100)}%</output></span>
      <input id={`sound-${kind}`} type="range" min="0" max="100" value={Math.round(settings[kind] * 100)}
        onChange={event => setSoundSettings({ [kind]: Number(event.target.value) / 100 })} />
    </label>)}
    <button type="button" className="btn btn-muted" disabled={settings.muted || settings.effects === 0}
      onClick={() => { void tableAudio.unlock().then(() => tableAudio.play('bet')); }}>効果音を試す</button>
    <details className="sound-credits"><summary>音源クレジット</summary>
      <p>効果音：<a href="https://kenney.nl/assets/casino-audio" target="_blank" rel="noreferrer">Casino Audio — Kenney</a></p>
      <p>BGM：<a href="https://opengameart.org/content/basically-not-fusion-jazz" target="_blank" rel="noreferrer">(Basically not) Fusion Jazz — Spring Spring / Julie Damsgaard</a></p>
      <p><a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer">CC0 1.0</a> · MP3変換、BGMの冒頭・末尾にフェードを追加</p>
    </details>
  </div>;
}
