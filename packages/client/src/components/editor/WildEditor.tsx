import { RANKS, type Rank, type RankingRules, type Suit, type Variant, type WildRule } from '@wildcard/engine';
import { InfoTip } from '../InfoTip.js';
import { withExcluded } from './DeckEditor.js';

const SUIT_MARK: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

/**
 * ワイルドの設定。
 *
 * よく使う「2がワイルド」のようなランクの指定はここで選ぶ。ジョーカーはデッキに
 * 入れれば何にでも化ける（設定は要らない）。
 * 特定の札だけをワイルドにする規則（片目のジャックなど）はプリセットから引き継いだ分を見せ、外せる。
 */
export function WildEditor({ variant, onChange }: { readonly variant: Variant; readonly onChange: (ranking: RankingRules) => void }) {
  const rules = variant.ranking.wilds ?? [];
  const rankRule = rules.find((rule) => rule.cards.kind === 'rank');
  const wildRanks = rules.flatMap((rule) => (rule.cards.kind === 'rank' ? rule.cards.ranks : []));
  const display = withExcluded([...variant.deck.ranks].reverse(), RANKS);
  const jokers = variant.deck.jokers ?? 0;
  const jokerRule = rules.find((rule) => rule.cards.kind === 'joker');

  const setRules = (next: readonly WildRule[]) => {
    const { wilds: _removed, ...rest } = variant.ranking;
    onChange(next.length > 0 ? { ...rest, wilds: next } : rest);
  };

  const toggleRank = (rank: Rank) => {
    const nextRanks = wildRanks.includes(rank) ? wildRanks.filter((r) => r !== rank) : [...wildRanks, rank];
    // ランクの規則は1つにまとめる。化ける先の制限は最初の規則のものを引き継ぐ。
    const others = rules.filter((rule) => rule.cards.kind !== 'rank');
    const ordered = RANKS.filter((r) => nextRanks.includes(r));
    setRules(ordered.length === 0 ? others : [...others, { ...(rankRule ?? {}), cards: { kind: 'rank', ranks: ordered } }]);
  };

  return (
    <div className="field wild-editor">
      <div className="field-head">
        <span className="field-label">ワイルド<InfoTip label="ワイルド">選んだランクの札は、役を判定するとき何にでも化けて、いちばん強くなる札として数えます。ジョーカーはデッキに入れれば常にワイルドです。</InfoTip></span>
      </div>
      <div className="wild-line">
        <span className="wild-line-label">ランク</span>
        <div className="chips chips-ranks">
          {display.map((rank) => (
            <button key={rank} type="button" aria-pressed={wildRanks.includes(rank)} aria-label={`${rank} をワイルドにする`}
              className={`chip chip-sm ${wildRanks.includes(rank) ? 'chip-on' : ''} ${variant.deck.ranks.includes(rank) ? '' : 'chip-missing'}`}
              onClick={() => toggleRank(rank)}>{rank}</button>
          ))}
        </div>
      </div>
      <div className="wild-line">
        <span className="wild-line-label">ジョーカー</span>
        <span className="wild-note">{jokers === 0 ? 'デッキに入っていません' : jokerRule?.becomes ? `${jokers}枚・${limitText(jokerRule)}` : `${jokers}枚・何にでも化ける`}</span>
      </div>
      {rules.filter((rule) => rule.cards.kind === 'card').map((rule, i) => rule.cards.kind === 'card' && (
        <div key={i} className="wild-line">
          <span className="wild-line-label">札</span>
          <span className="wild-note">{rule.cards.cards.map((card) => `${card.rank}${SUIT_MARK[card.suit]}`).join('・')}{rule.becomes ? `（${limitText(rule)}）` : ''}</span>
          <button type="button" className="btn btn-ghost wild-remove" aria-label="この札のワイルドを外す" onClick={() => setRules(rules.filter((r) => r !== rule))}>外す</button>
        </div>
      ))}
    </div>
  );
}

/** 化ける先の制限を一言で。 */
function limitText(rule: WildRule): string {
  const parts: string[] = [];
  if (rule.becomes?.ranks) parts.push(`${rule.becomes.ranks.join('・')} にだけ化ける`);
  if (rule.becomes?.suits) parts.push(`${rule.becomes.suits.map((s) => SUIT_MARK[s]).join('')} にだけ化ける`);
  return parts.join('、') || '何にでも化ける';
}
