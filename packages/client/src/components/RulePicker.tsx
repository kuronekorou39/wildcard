import { useMemo, useRef, useState } from 'react';
import {
  activeRankings,
  boardSize,
  deckSize,
  describePattern,
  describeWilds,
  evaluateExact,
  exampleHands,
  wildResolutions,
} from '@wildcard/engine';
import type { Card, Variant } from '@wildcard/engine';
import { PlayingCard, cardLabel } from './PlayingCard.js';
import { DeckContents } from './DeckContents.js';
import { isCustomVariant, useVariants } from '../rules/customVariants.js';
import { GameDialog } from './GameDialog.js';
import { RuleBanner } from './RuleBanner.js';
import { Icon } from './Icon.js';
import { EMPTY_RULE_FILTERS, filterVariants, type RuleFilters } from '../rules/filterVariants.js';

interface RulePickerProps {
  readonly value: string;
  readonly onChange: (variantId: string) => void;
  /** 編集画面を開く。渡さなければボタンを出さない。 */
  readonly onEdit?: (variantId: string) => void;
}

/**
 * ルールの選択。
 *
 * 並んでいるものはすべて Variant というデータで、エンジンのコードは
 * どれを選んでも同じ。Wildcard の中心にある考え方が最初に目に入る場所なので、
 * 何が変わるのかをその場で読めるようにしてある。
 */
export function RulePicker({ value, onChange, onEdit }: RulePickerProps) {
  const variants = useVariants();
  const selected = variants.find((v) => v.id === value) ?? variants[0]!;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [filters, setFilters] = useState<RuleFilters>(EMPTY_RULE_FILTERS);
  const matches = filterVariants(variants, filters);
  const updateFilter = (patch: Partial<RuleFilters>) => setFilters(current => ({ ...current, ...patch }));
  const clearSearch = () => { setFilters(EMPTY_RULE_FILTERS); setAdvanced(false); };

  return (
    <div className="rule-picker">
      <button ref={trigger} type="button" className="rule-select-trigger" aria-label={`ルールを選ぶ：${selected.name}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { clearSearch(); setSearchOpen(false); setOpen(true); }}>
        <RuleBanner variant={selected} />
        <span className="selected-rule-title"><strong>{selected.name}</strong><span className="rule-chevron" aria-hidden="true"><Icon kind="chevron-down" /></span></span>
      </button>
      <dl className="rule-facts"><div><dt>デッキ</dt><dd>{deckSize(selected.deck)}<small>枚</small></dd></div><div><dt>手札</dt><dd>{selected.structure.holeCards}<small>枚</small></dd></div><div><dt>ボード</dt><dd>{boardSize(selected.structure)}<small>枚</small></dd></div><div><dt>ベット</dt><dd className="rule-limit">{selected.betting.limit === 'no-limit' ? 'NL' : selected.betting.limit === 'pot-limit' ? 'PL' : 'FL'}</dd></div></dl>
      <div className="rule-actions">
        <button type="button" className="rule-tool" aria-label="ルール詳細" title="ルール詳細" onClick={() => setSheet(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.5" /></svg>
        </button>
        {onEdit && <button type="button" className="rule-tool rule-edit-button" aria-label={isCustomVariant(selected.id) ? 'このルールを編集' : 'これを元に作る'} title={isCustomVariant(selected.id) ? 'ルールを編集' : 'コピーして編集'} onClick={() => onEdit(selected.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z" /></svg>
        </button>}
      </div>
      {open && <GameDialog title="ルールを選ぶ" className="rule-select-dialog" anchor={trigger.current} initialFocus=".rule-option[aria-selected=true]" onClose={() => setOpen(false)}
        actions={onEdit && <button type="button" className="btn btn-muted btn-small" onClick={() => { setOpen(false); onEdit('standard'); }}><Icon kind="plus" />作成</button>}>
        <div className="rule-search-toolbar"><span role="status">{matches.length} 件</span><button type="button" className="search-toggle" aria-expanded={searchOpen} aria-controls="rule-search-panel" onClick={() => {
          setSearchOpen(!searchOpen);
          if (searchOpen) clearSearch();
        }}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>{searchOpen ? '検索を閉じる' : '検索・絞り込み'}</button></div>
        {searchOpen && <div className="rule-search-panel" id="rule-search-panel">
          <input type="search" className="input rule-search" aria-label="ルールを検索" placeholder="名前・キーワード" value={filters.query} onChange={event => updateFilter({ query: event.target.value })} onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.closest('dialog')?.querySelector<HTMLButtonElement>('[role=option]')?.focus(); }
          }} />
          <div className="rule-filter-row"><div className="rule-source-filters" role="group" aria-label="ルールの種類">
            {([['all', 'すべて'], ['preset', '既定'], ['custom', '自作']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filters.source === value} onClick={() => updateFilter({ source: value })}>{label}</button>)}
          </div><button type="button" className="search-toggle" aria-expanded={advanced} aria-controls="rule-advanced-filters" onClick={() => {
            setAdvanced(!advanced);
            if (advanced) updateFilter({ holeCards: '', limit: '', deck: 'all' });
          }}>詳細条件 <Icon kind={advanced ? 'minus' : 'plus'} /></button></div>
          {advanced && <div className="rule-advanced-filters" id="rule-advanced-filters">
            <label><span>手札</span><select aria-label="手札枚数" className="input" value={filters.holeCards} onChange={event => updateFilter({ holeCards: event.target.value })}><option value="">すべて</option>{[...new Set(variants.map(v => v.structure.holeCards))].sort((a, b) => a - b).map(n => <option key={n} value={n}>{n}枚</option>)}</select></label>
            <label><span>デッキ</span><select aria-label="デッキ枚数" className="input" value={filters.deck} onChange={event => updateFilter({ deck: event.target.value as RuleFilters['deck'] })}><option value="all">すべて</option><option value="short">52枚未満</option><option value="standard">52枚</option><option value="large">53枚以上</option></select></label>
            <label><span>ベット</span><select aria-label="ベット形式" className="input" value={filters.limit} onChange={event => updateFilter({ limit: event.target.value })}><option value="">すべて</option><option value="no-limit">NL</option><option value="pot-limit">PL</option><option value="fixed-limit">FL</option></select></label>
          </div>}
          {(filters.query || filters.source !== 'all' || filters.holeCards || filters.limit || filters.deck !== 'all') && <button type="button" className="search-clear" onClick={clearSearch}>条件をクリア</button>}
        </div>}
        <div className="rule-options" role="listbox" aria-label="ルール" onKeyDown={event => {
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'));
          const current = options.indexOf(document.activeElement as HTMLButtonElement);
          let next: number;
          if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
          else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = options.length - 1;
          else return;
          event.preventDefault(); options[next]?.focus();
        }}>
          {matches.map(variant => <button type="button" role="option" aria-selected={variant.id === selected.id} data-variant={variant.id} key={variant.id}
            className="rule-option" onClick={() => { onChange(variant.id); setOpen(false); }}>
            <RuleBanner variant={variant} compact />
            <span><strong>{variant.name}</strong><small>{isCustomVariant(variant.id) ? 'カスタム · ' : ''}{deckSize(variant.deck)}枚 · 手札{variant.structure.holeCards}枚</small></span>
            <span className="rule-option-check" aria-hidden="true">{variant.id === selected.id && <Icon kind="check" />}</span>
          </button>)}
          {matches.length === 0 && <p className="hint">該当するルールはありません。</p>}
        </div>
      </GameDialog>}
      {sheet && <GameDialog title={selected.name} className="setup-rule-dialog" onClose={() => setSheet(false)}><RuleSheet variant={selected} defaultOpen label="役の順位と例" /></GameDialog>}
    </div>
  );
}

interface RuleSheetProps {
  /**
   * 見せるルールそのもの。id ではなく実体を受け取る。
   *
   * オンラインではガイドの端末にプリセットが無いこともある
   * （ホストが作ったカスタムルール）。卓の state には Variant が
   * まるごと入って届くので、それをそのまま渡せばよい。
   */
  readonly variant: Variant | null;
  readonly label?: string;
  readonly defaultOpen?: boolean;
}

/**
 * 有効な役を強い順に並べて見せる。変則ルールでは手元に欲しくなる。
 *
 * **役名だけでは足りない。** 「素数ストレート」「ペア＋三連」のような
 * 独自役は、名前を見ても何が成立するのか分からない。条件の説明と、
 * 実際に成立する札を一緒に出す（→ engine の example.ts）。
 */
export function RuleSheet({ variant, label = 'ルール', defaultOpen = false }: RuleSheetProps) {
  // 例は役ごとに試行を回して作る。卓の画面にも出るので、
  // 開くまでは計算しない。閉じたままなら一度も走らない。
  const [opened, setOpened] = useState(defaultOpen);
  const examples = useMemo(
    () =>
      variant && opened ? exampleHands(variant, { seed: 11 }) : new Map<string, Card[] | null>(),
    [variant, opened],
  );

  if (!variant) return null;

  const rankings = activeRankings(variant);
  const deck = variant.deck;
  const wilds = describeWilds(variant);

  return (
    <details className="rule-sheet" open={opened} onToggle={(e) => setOpened(e.currentTarget.open)}>
      <summary className="rule-sheet-summary">{label}</summary>
      <div className="rule-sheet-body">
        <p className="rule-sheet-deck">
          デッキ {deckSize(deck)}枚（{deck.ranks.join(' ')}）
          {deck.suitRanking !== undefined && ' ／ スートに強弱あり'}
          <br />
          手札{variant.structure.holeCards}枚 ／ 場{boardSize(variant.structure)}枚
          {variant.structure.holeUsage !== undefined &&
            ` ／ 手札からちょうど${variant.structure.holeUsage.min}枚使う`}
          {wilds !== null && (
            <>
              {/* 「デッキ53枚」だけでは、その1枚が何なのか分からない。 */}
              <br />
              <span className="rule-sheet-wilds">{wilds}</span>
            </>
          )}
        </p>
        {opened && <details className="deck-card-editor"><summary>デッキのカード一覧</summary><DeckContents deck={deck} /></details>}
        <ol className="rule-sheet-list">
          {rankings.map((ranking) => (
            <li key={ranking.id} className="rule-row">
              <div className="rule-row-head">
                <span className="rule-row-name">{ranking.name}</span>
                <span className="rule-row-pattern">{describePattern(ranking.pattern)}</span>
              </div>
              <RuleExample variant={variant} hand={examples.get(ranking.id) ?? null} />
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

interface RuleExampleProps {
  readonly variant: Variant;
  readonly hand: readonly Card[] | null;
}

/** その役が成立する札の一例。 */
function RuleExample({ variant, hand }: RuleExampleProps) {
  if (!hand) {
    // 条件が厳しすぎて例が作れないことはある。黙って消すより、そう言う。
    return <p className="rule-row-example-none">このデッキでは成立しない</p>;
  }

  // ワイルドが混ざった手は札を見ただけでは読めない。
  // 「J J J 2 2 がファイブカード」は、2 が J になったことが見えて初めて分かる。
  const result = evaluateExact(hand, variant);
  const wilds = result ? wildResolutions(result, variant) : [];

  return (
    <div className="rule-row-example">
      <div className="rule-row-cards">
        {hand.map((card, i) => (
          <PlayingCard key={i} card={card} size="sm" />
        ))}
      </div>
      {wilds.length > 0 && (
        <span className="rule-row-wilds">
          {wilds
            // スートに意味が無い役では、スートまで書くと嘘に見える
            // （手の中に本物の 8♠ が居るのに「JOKER→8♠」と出てしまう）。
            .map((w) => `${cardLabel(w.card)}→${w.suitMatters ? cardLabel(w.becomes) : w.becomes.rank}`)
            .join('、')}
        </span>
      )}
    </div>
  );
}
