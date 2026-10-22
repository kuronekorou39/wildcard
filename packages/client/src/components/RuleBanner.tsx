import { useEffect, useRef, useState } from 'react';
import type { Variant } from '@wildcard/engine';
import { BANNER_TONES, readBannerFile, useRuleBanner, type RuleBannerStyle } from '../rules/ruleBanners.js';

export function RuleBanner({ variant, style, compact = false }: { readonly variant: Variant; readonly style?: RuleBannerStyle; readonly compact?: boolean }) {
  const saved = useRuleBanner(variant.id);
  const appearance = style ?? saved;
  return <span className={`rule-banner banner-${appearance.tone} ${compact ? 'rule-banner-compact' : ''}`} aria-hidden="true">
    {appearance.image ? <img src={appearance.image} alt="" /> : <>
      <span className="banner-orbit" /><span className="banner-suit">{variant.deck.jokers ? '✦' : variant.structure.holeCards > 2 ? '♦' : '♠'}</span>
      <span className="banner-cards">{Array.from({ length: Math.min(4, Math.max(2, variant.structure.holeCards)) }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties}>{['A', 'K', 'Q', 'J'][i]}<small>{['♠', '♥', '♦', '♣'][i]}</small></i>)}</span>
    </>}
  </span>;
}

export function BannerEditor({ variant, value, onChange, onBusyChange }: { readonly variant: Variant; readonly value: RuleBannerStyle; readonly onChange: (value: RuleBannerStyle) => void; readonly onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const markBusy = (next: boolean) => { setBusy(next); onBusyChange?.(next); };
  useEffect(() => () => { generation.current++; onBusyChange?.(false); }, [onBusyChange]);
  return <div className="banner-editor">
    <RuleBanner variant={variant} style={value} />
    <div className="banner-editor-tools">
      <div className="banner-tones" aria-label="バナーの配色">
        {BANNER_TONES.map((tone, i) => <button type="button" key={tone} className={`banner-tone banner-${tone}`} aria-label={['ワイン', 'フォレスト', 'スレート', 'カッパー', 'プラム'][i]} aria-pressed={value.tone === tone && !value.image}
          onClick={() => { generation.current++; markBusy(false); setError(''); onChange({ tone }); }} />)}
      </div>
      <button type="button" className="btn btn-muted" disabled={busy} onClick={() => input.current?.click()}>{busy ? '読込中…' : '画像を選ぶ'}</button>
      {value.image && <button type="button" className="btn btn-ghost" onClick={() => { generation.current++; markBusy(false); onChange({ tone: value.tone }); }}>画像を外す</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="バナー画像" className="visually-hidden" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        const token = ++generation.current; markBusy(true); setError('');
        try { const image = await readBannerFile(file); if (token === generation.current) onChange({ ...value, image }); }
        catch (cause) { if (token === generation.current) setError(cause instanceof Error ? cause.message : '画像を読み込めませんでした。'); }
        finally { if (token === generation.current) markBusy(false); }
      }} />
    </div>
    <p className="hint">バナーはこのブラウザに保存されます。画像は中央を基準に 3:1 で切り抜きます。</p>
    {error && <p className="hint hint-warn" role="alert">{error}</p>}
  </div>;
}
