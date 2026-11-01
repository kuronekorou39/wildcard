import { useEffect, useRef, useState } from 'react';
import { deckSize, type Variant } from '@wildcard/engine';
import { BANNER_MOTIFS, BANNER_MOTIF_LABELS, BANNER_TONES, BANNER_TONE_LABELS, readBannerFile, useRuleBanner, type BannerMotif, type RuleBannerStyle } from '../rules/ruleBanners.js';

export function RuleBanner({ variant, style, compact = false }: { readonly variant: Variant; readonly style?: RuleBannerStyle; readonly compact?: boolean }) {
  const saved = useRuleBanner(variant.id);
  const appearance = style ?? saved;
  return <span className={`rule-banner banner-${appearance.tone} motif-${appearance.motif} ${compact ? 'rule-banner-compact' : ''}`} aria-hidden="true">
    {appearance.image ? <img src={appearance.image} alt="" /> : <span className="banner-art"><BannerMotifArt variant={variant} motif={appearance.motif} /></span>}
  </span>;
}

function BannerMotifArt({ variant, motif }: { readonly variant: Variant; readonly motif: BannerMotif }) {
  switch (motif) {
    case 'cards': return <>
      <span className="banner-orbit" /><span className="banner-suit">{variant.deck.jokers ? '✦' : variant.structure.holeCards > 2 ? '♦' : '♠'}</span>
      <span className="banner-cards">{Array.from({ length: Math.min(4, Math.max(2, variant.structure.holeCards)) }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties}>{['A', 'K', 'Q', 'J'][i]}<small>{['♠', '♥', '♦', '♣'][i]}</small></i>)}</span>
    </>;
    case 'chips': return <>
      <span className="chips-ghost" />
      <svg className="chips-art" viewBox="0 0 220 150">
        <ChipStack cx={122} base={70} count={7} tone="b" />
        <ChipStack cx={80} base={104} count={5} tone="a" />
        <ChipStack cx={160} base={114} count={3} tone="c" />
      </svg>
    </>;
    case 'felt': return <svg className="felt-art" viewBox="0 0 300 200" preserveAspectRatio="xMaxYMid slice">
      <ellipse className="felt-cloth" cx="170" cy="330" rx="280" ry="225" />
      <ellipse className="felt-rail" cx="170" cy="330" rx="290" ry="235" />
      <ellipse className="felt-stitch" cx="170" cy="330" rx="290" ry="235" />
      <ellipse className="felt-rail-edge" cx="170" cy="330" rx="300" ry="245" />
      <ellipse className="felt-line" cx="170" cy="330" rx="245" ry="196" />
      <g className="felt-button" transform="translate(238 124)">
        <ellipse cy="2.4" rx="10" ry="5.6" className="felt-button-side" /><ellipse rx="10" ry="5.6" /><text y="2.3" transform="scale(1 .62)">D</text>
      </g>
      <g className="felt-bet">
        <ellipse cx="128" cy="146" rx="8" ry="4.2" className="felt-chip-side" /><ellipse cx="128" cy="143.6" rx="8" ry="4.2" className="felt-chip" />
        <ellipse cx="128" cy="141.2" rx="8" ry="4.2" className="felt-chip-side" /><ellipse cx="128" cy="138.8" rx="8" ry="4.2" className="felt-chip" />
      </g>
    </svg>;
    case 'suits': return <>
      <span className="suits-field"><span className="suits-tile suits-dark" /><span className="suits-tile suits-red" /></span>
      <span className="suits-medal"><i>{variant.deck.jokers ? '✦' : '♠'}</i></span>
    </>;
    case 'deco': return <>
      <span className="deco-rays" /><span className="deco-fan" /><span className="deco-frame" />
    </>;
    case 'joker': return <>
      <span className="banner-suit">✦</span>
      <svg className="joker-art" viewBox="0 0 200 160">
        <path className="joker-lobe joker-side" d="M50 120 C45 88 32 62 14 52 C42 48 72 70 90 114 Z" />
        <path className="joker-lobe joker-side" d="M150 120 C155 88 168 62 186 52 C158 48 128 70 110 114 Z" />
        <path className="joker-lobe joker-center" d="M68 122 C74 82 92 42 100 18 C108 42 126 82 132 122 Z" />
        <path className="joker-band" d="M44 116 Q100 132 156 116 L158 136 Q100 152 42 136 Z" />
        {/* 帯の曲線（中央で 8 下がる）に沿って菱形を並べる */}
        {[62, 81, 100, 119, 138].map(x => <path key={x} className="joker-diamond" d={`M${x - 5} ${126 + 8 * (1 - ((x - 100) / 56) ** 2)} l5 -6 l5 6 l-5 6 Z`} />)}
        <circle className="joker-bell" cx="14" cy="52" r="7" /><circle className="joker-bell" cx="100" cy="17" r="7.5" /><circle className="joker-bell" cx="186" cy="52" r="7" />
      </svg>
      <span className="joker-stars"><i>✦</i><i>✦</i><i>✧</i><i>✦</i></span>
    </>;
    case 'numeral': {
      const size = deckSize(variant.deck);
      const hole = variant.structure.holeCards;
      const [value, caption] = size === 52 && hole !== 2 ? [hole, 'HOLE CARDS'] : [size, 'CARD DECK'];
      return <span className="numeral-art"><b>{value}</b><small>{caption}</small></span>;
    }
  }
}

/** 斜めから見たチップの山。下の1枚から順に描き、上の札が下の天面を隠す。 */
function ChipStack({ cx, base, count, tone }: { readonly cx: number; readonly base: number; readonly count: number; readonly tone: 'a' | 'b' | 'c' }) {
  const rx = 30, ry = 11, h = 7;
  return <g className={`chip-stack chip-${tone}`}>
    {Array.from({ length: count }, (_, i) => {
      const y = base - i * h;
      return <g key={i}>
        <ellipse className="chip-side" cx={cx} cy={y + h} rx={rx} ry={ry} />
        <rect className="chip-side" x={cx - rx} y={y} width={rx * 2} height={h} />
        <path className="chip-edge" d={`M${cx - rx} ${y + h / 2} A${rx} ${ry} 0 0 0 ${cx + rx} ${y + h / 2}`} />
        <ellipse className="chip-top" cx={cx} cy={y} rx={rx} ry={ry} />
      </g>;
    })}
    <ellipse className="chip-ring" cx={cx} cy={base - (count - 1) * h} rx={rx * .7} ry={ry * .7} />
  </g>;
}

export function BannerEditor({ variant, value, onChange, onBusyChange }: { readonly variant: Variant; readonly value: RuleBannerStyle; readonly onChange: (value: RuleBannerStyle) => void; readonly onBusyChange?: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const markBusy = (next: boolean) => { setBusy(next); onBusyChange?.(next); };
  useEffect(() => () => { generation.current++; onBusyChange?.(false); }, [onBusyChange]);
  // 色や絵柄を選ぶと、読み込んだ画像は外れる。
  const pick = (next: Pick<RuleBannerStyle, 'tone' | 'motif'>) => { generation.current++; markBusy(false); setError(''); onChange(next); };
  return <div className="banner-editor">
    <RuleBanner variant={variant} style={value} />
    <div className="banner-editor-tools">
      <div className="banner-tones" role="group" aria-label="バナーの配色">
        {BANNER_TONES.map(tone => <button type="button" key={tone} className={`banner-tone banner-${tone}`} aria-label={BANNER_TONE_LABELS[tone]} title={BANNER_TONE_LABELS[tone]} aria-pressed={value.tone === tone && !value.image}
          onClick={() => pick({ tone, motif: value.motif })} />)}
      </div>
      <button type="button" className="btn btn-muted" disabled={busy} onClick={() => input.current?.click()}>{busy ? '読込中…' : '画像を選ぶ'}</button>
      {value.image && <button type="button" className="btn btn-ghost" onClick={() => { generation.current++; markBusy(false); onChange({ tone: value.tone, motif: value.motif }); }}>画像を外す</button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="バナー画像" className="visually-hidden" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        const token = ++generation.current; markBusy(true); setError('');
        try { const image = await readBannerFile(file); if (token === generation.current) onChange({ ...value, image }); }
        catch (cause) { if (token === generation.current) setError(cause instanceof Error ? cause.message : '画像を読み込めませんでした。'); }
        finally { if (token === generation.current) markBusy(false); }
      }} />
    </div>
    <div className="banner-motifs" role="group" aria-label="バナーの絵柄">
      {BANNER_MOTIFS.map(motif => <button type="button" key={motif} className="banner-motif" aria-label={`絵柄：${BANNER_MOTIF_LABELS[motif]}`} aria-pressed={value.motif === motif && !value.image}
        onClick={() => pick({ tone: value.tone, motif })}>
        <RuleBanner variant={variant} style={{ tone: value.tone, motif }} compact />
        <span>{BANNER_MOTIF_LABELS[motif]}</span>
      </button>)}
    </div>
    <p className="hint">バナーはこのブラウザに保存されます。画像は中央を基準に 3:1 で切り抜きます。</p>
    {error && <p className="hint hint-warn" role="alert">{error}</p>}
  </div>;
}
