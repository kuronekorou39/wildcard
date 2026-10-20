const mascotUrl = `${import.meta.env.BASE_URL}brand/dragon.png`;

/** 元のキャラクターを共通利用する。小さいマークは画像の表示範囲だけを変える。 */
export function CharacterMark() {
  return (
    <span className="character-mark" aria-hidden="true">
      <img src={mascotUrl} alt="" width={485} height={723} />
    </span>
  );
}

export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`brand${compact ? ' brand-compact' : ''}`}>
      <CharacterMark />
      <span>Wildcard<span className="brand-dot">.</span></span>
    </span>
  );
}

export function HeroCharacter() {
  return (
    <div className="hero-character">
      <img src={mascotUrl} alt="黒いベストと帽子を身につけた、赤いドラゴンのディーラー" width={485} height={723} />
      <span className="hero-character-label" aria-hidden="true">WELCOME TO THE CLUB</span>
    </div>
  );
}
