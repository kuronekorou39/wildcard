import {
  RANKS,
  SUITS,
  type BettingRules,
  type CardColor,
  type CardCondition,
  type CardCount,
  type DeckRules,
  type GlobalCondition,
  type HandPattern,
  type HandRanking,
  type HandStructure,
  type LimitKind,
  type Rank,
  type RankSpec,
  type RankingRules,
  type ShowCardsPolicy,
  type Street,
  type StreetCap,
  type Suit,
  type TableOptions,
  type UsageRange,
  type Variant,
  type WildRule,
  type WildSelector,
} from '../types.js';

/**
 * 外から来た JSON を Variant として読む。
 *
 * ルールはデータなので、**保存した設定・貼り付けたコード・ホストから届いた卓**は
 * すべて「外から来た JSON」である。型注釈を付けるだけで通すと、壊れた保存や
 * 古い形式がそのままエンジンへ流れ込み、対局の最中に落ちる。
 *
 * ここでやるのは **形の検査だけ**。「52枚で5人回るか」のような整合性は
 * validateVariant が見る（人数が要るので、形だけでは決まらない）。
 */

export type ParseResult =
  | { readonly ok: true; readonly variant: Variant }
  | { readonly ok: false; readonly problems: readonly string[] };

/** 文字列から読む。JSON として壊れていても落ちない。 */
export function parseVariantJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`JSON として読めない: ${(error as Error).message}`] };
  }
  return parseVariant(data);
}

/** 書き出す。読み返せることは parse 側のテストで担保する。 */
export const variantToJson = (variant: Variant): string => JSON.stringify(variant, null, 2);

export function parseVariant(input: unknown): ParseResult {
  const p = new Problems();
  const root = p.object(input, 'ルール');
  if (!root) return { ok: false, problems: p.list };

  const variant: Variant = {
    id: p.string(root['id'], 'id') ?? '',
    name: p.string(root['name'], 'name') ?? '',
    ...optional('description', p.optionalString(root['description'], 'description')),
    deck: parseDeck(root['deck'], 'deck', p),
    structure: parseStructure(root['structure'], 'structure', p),
    betting: parseBetting(root['betting'], 'betting', p),
    ranking: parseRanking(root['ranking'], 'ranking', p),
    ...optional('options', parseOptions(root['options'], 'options', p)),
  };

  return p.list.length > 0 ? { ok: false, problems: p.list } : { ok: true, variant };
}

// ============================================================
// 問題の集め方
// ============================================================

/**
 * 見つけた問題をすべて集める。最初の1件で投げない。
 *
 * 編集画面に出すものなので、「1つ直すたびに次の1つが出る」のは使いづらい。
 */
class Problems {
  readonly list: string[] = [];

  at(path: string, message: string): undefined {
    this.list.push(`${path}: ${message}`);
    return undefined;
  }

  object(value: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return this.at(path, 'オブジェクトではない');
    }
    return value as Record<string, unknown>;
  }

  array(value: unknown, path: string): unknown[] | undefined {
    if (!Array.isArray(value)) return this.at(path, '配列ではない');
    return value;
  }

  string(value: unknown, path: string): string | undefined {
    if (typeof value !== 'string') return this.at(path, '文字列ではない');
    return value;
  }

  optionalString(value: unknown, path: string): string | undefined {
    return value === undefined ? undefined : this.string(value, path);
  }

  number(value: unknown, path: string): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.at(path, '数ではない');
    }
    return value;
  }

  optionalNumber(value: unknown, path: string): number | undefined {
    return value === undefined ? undefined : this.number(value, path);
  }

  optionalBoolean(value: unknown, path: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') return this.at(path, '真偽値ではない');
    return value;
  }

  /** 決められた一覧のどれかか。ランク・スート・制度はすべてこれで見る。 */
  literal<T extends string>(value: unknown, path: string, allowed: readonly T[]): T | undefined {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      return this.at(path, `${allowed.join(' / ')} のいずれかではない`);
    }
    return value as T;
  }

  /** 配列の各要素を読む。読めなかった要素は落とす（問題は記録済み）。 */
  each<T>(value: unknown, path: string, read: (item: unknown, path: string) => T | undefined): T[] {
    const list = this.array(value, path);
    if (!list) return [];
    const out: T[] = [];
    for (const [i, item] of list.entries()) {
      const parsed = read(item, `${path}[${i}]`);
      if (parsed !== undefined) out.push(parsed);
    }
    return out;
  }
}

/** 値が undefined なら、そのキー自体を作らない。 */
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

// ============================================================
// 軸ごと
// ============================================================

const rank = (p: Problems) => (value: unknown, path: string) => p.literal<Rank>(value, path, RANKS);
const suit = (p: Problems) => (value: unknown, path: string) => p.literal<Suit>(value, path, SUITS);

function parseDeck(value: unknown, path: string, p: Problems): DeckRules {
  const deck = p.object(value, path);
  if (!deck) return { suits: [], ranks: [] };

  const overrides = deck['overrides'];
  return {
    suits: p.each(deck['suits'], `${path}.suits`, suit(p)),
    ranks: p.each(deck['ranks'], `${path}.ranks`, rank(p)),
    ...optional(
      'sequence',
      deck['sequence'] === undefined ? undefined : p.each(deck['sequence'], `${path}.sequence`, rank(p)),
    ),
    ...optional(
      'suitRanking',
      deck['suitRanking'] === undefined
        ? undefined
        : p.each(deck['suitRanking'], `${path}.suitRanking`, suit(p)),
    ),
    ...optional('copies', p.optionalNumber(deck['copies'], `${path}.copies`)),
    ...optional('jokers', p.optionalNumber(deck['jokers'], `${path}.jokers`)),
    ...optional(
      'overrides',
      overrides === undefined
        ? undefined
        : p.each(overrides, `${path}.overrides`, (item, at) => parseCardCount(item, at, p)),
    ),
  };
}

function parseCardCount(value: unknown, path: string, p: Problems): CardCount | undefined {
  const entry = p.object(value, path);
  if (!entry) return undefined;
  const r = rank(p)(entry['rank'], `${path}.rank`);
  const s = suit(p)(entry['suit'], `${path}.suit`);
  const count = p.number(entry['count'], `${path}.count`);
  if (r === undefined || s === undefined || count === undefined) return undefined;
  return { rank: r, suit: s, count };
}

function parseStructure(value: unknown, path: string, p: Problems): HandStructure {
  const structure = p.object(value, path);
  if (!structure) return { holeCards: 0, streets: [], handSize: 0 };

  return {
    holeCards: p.number(structure['holeCards'], `${path}.holeCards`) ?? 0,
    streets: p.each(structure['streets'], `${path}.streets`, (item, at) => parseStreet(item, at, p)),
    handSize: p.number(structure['handSize'], `${path}.handSize`) ?? 0,
    ...optional('holeUsage', parseUsage(structure['holeUsage'], `${path}.holeUsage`, p)),
    ...optional('boardUsage', parseUsage(structure['boardUsage'], `${path}.boardUsage`, p)),
  };
}

function parseStreet(value: unknown, path: string, p: Problems): Street | undefined {
  const street = p.object(value, path);
  if (!street) return undefined;
  const name = p.string(street['name'], `${path}.name`);
  const cards = p.number(street['cards'], `${path}.cards`);
  if (name === undefined || cards === undefined) return undefined;
  return { name, cards, ...optional('burn', p.optionalNumber(street['burn'], `${path}.burn`)) };
}

function parseUsage(value: unknown, path: string, p: Problems): UsageRange | undefined {
  if (value === undefined) return undefined;
  const usage = p.object(value, path);
  if (!usage) return undefined;
  const min = p.number(usage['min'], `${path}.min`);
  const max = p.number(usage['max'], `${path}.max`);
  if (min === undefined || max === undefined) return undefined;
  return { min, max };
}

const LIMITS: readonly LimitKind[] = ['no-limit', 'pot-limit', 'fixed-limit'];

function parseBetting(value: unknown, path: string, p: Problems): BettingRules {
  const betting = p.object(value, path);
  if (!betting) return { limit: 'no-limit' };

  const straddle = betting['straddle'];
  const caps = betting['streetCaps'];
  return {
    limit: p.literal<LimitKind>(betting['limit'], `${path}.limit`, LIMITS) ?? 'no-limit',
    ...optional('straddle', parseStraddle(straddle, `${path}.straddle`, p)),
    ...optional(
      'streetCaps',
      caps === undefined
        ? undefined
        : p.each(caps, `${path}.streetCaps`, (item, at) => parseStreetCap(item, at, p)),
    ),
    ...optional(
      'maxRaisesPerRound',
      p.optionalNumber(betting['maxRaisesPerRound'], `${path}.maxRaisesPerRound`),
    ),
    ...optional('bigBetFrom', p.optionalNumber(betting['bigBetFrom'], `${path}.bigBetFrom`)),
  };
}

function parseStraddle(
  value: unknown,
  path: string,
  p: Problems,
): { readonly max: number } | undefined {
  if (value === undefined) return undefined;
  const straddle = p.object(value, path);
  if (!straddle) return undefined;
  const max = p.number(straddle['max'], `${path}.max`);
  return max === undefined ? undefined : { max };
}

function parseStreetCap(value: unknown, path: string, p: Problems): StreetCap | undefined {
  const cap = p.object(value, path);
  if (!cap) return undefined;
  const street = p.number(cap['street'], `${path}.street`);
  if (street === undefined) return undefined;
  return {
    street,
    ...optional('noAllIn', p.optionalBoolean(cap['noAllIn'], `${path}.noAllIn`)),
    ...optional('maxTotal', p.optionalNumber(cap['maxTotal'], `${path}.maxTotal`)),
  };
}

function parseRanking(value: unknown, path: string, p: Problems): RankingRules {
  const ranking = p.object(value, path);
  if (!ranking) return { hands: [] };

  const wilds = ranking['wilds'];
  return {
    hands: p.each(ranking['hands'], `${path}.hands`, (item, at) => parseHand(item, at, p)),
    ...optional(
      'wilds',
      wilds === undefined
        ? undefined
        : p.each(wilds, `${path}.wilds`, (item, at) => parseWild(item, at, p)),
    ),
  };
}

function parseHand(value: unknown, path: string, p: Problems): HandRanking | undefined {
  const hand = p.object(value, path);
  if (!hand) return undefined;
  const id = p.string(hand['id'], `${path}.id`);
  const name = p.string(hand['name'], `${path}.name`);
  const enabled = p.optionalBoolean(hand['enabled'], `${path}.enabled`);
  if (id === undefined || name === undefined) return undefined;
  return {
    id,
    name,
    // 省略は「有効」と読む。役を足したのに出てこないほうが分かりにくい。
    enabled: enabled ?? true,
    pattern: parsePattern(hand['pattern'], `${path}.pattern`, p),
  };
}

function parsePattern(value: unknown, path: string, p: Problems): HandPattern {
  const pattern = p.object(value, path);
  if (!pattern) return { cards: [], global: [] };
  return {
    cards: p.each(pattern['cards'], `${path}.cards`, (item, at) => parseCondition(item, at, p)),
    global: p.each(pattern['global'] ?? [], `${path}.global`, (item, at) =>
      parseGlobal(item, at, p),
    ),
  };
}

function parseCondition(value: unknown, path: string, p: Problems): CardCondition | undefined {
  const cond = p.object(value, path);
  if (!cond) return undefined;
  const spec = parseRankSpec(cond['rank'], `${path}.rank`, p);
  if (!spec) return undefined;
  const suitGroup = cond['suitGroup'] === undefined ? undefined : p.string(cond['suitGroup'], `${path}.suitGroup`);
  const split = p.optionalBoolean(cond['split'], `${path}.split`);
  return {
    rank: spec,
    suits: p.each(cond['suits'] ?? [], `${path}.suits`, suit(p)),
    ...optional('suitGroup', suitGroup),
    ...(split === true ? { split: true as const } : {}),
  };
}

function parseRankSpec(value: unknown, path: string, p: Problems): RankSpec | undefined {
  const spec = p.object(value, path);
  if (!spec) return undefined;

  switch (spec['type']) {
    case 'fixed': {
      const v = rank(p)(spec['value'], `${path}.value`);
      return v === undefined ? undefined : { type: 'fixed', value: v };
    }
    case 'oneOf':
      return { type: 'oneOf', values: p.each(spec['values'], `${path}.values`, rank(p)) };
    case 'variable': {
      const name = p.string(spec['name'], `${path}.name`);
      if (name === undefined) return undefined;
      return {
        type: 'variable',
        name,
        ...optional('offset', p.optionalNumber(spec['offset'], `${path}.offset`)),
        ...optional('wrap', p.optionalBoolean(spec['wrap'], `${path}.wrap`) || undefined),
      };
    }
    case 'any':
      return { type: 'any' };
    default:
      return p.at(`${path}.type`, 'fixed / oneOf / variable / any のいずれかではない');
  }
}

function parseGlobal(value: unknown, path: string, p: Problems): GlobalCondition | undefined {
  const global = p.object(value, path);
  if (!global) return undefined;

  switch (global['type']) {
    case 'allSameSuit':
      return { type: 'allSameSuit' };
    case 'allDifferentSuit':
      return { type: 'allDifferentSuit' };
    case 'consecutive':
      return p.optionalBoolean(global['wrap'], `${path}.wrap`) ? { type: 'consecutive', wrap: true } : { type: 'consecutive' };
    case 'allDifferentRank':
      return { type: 'allDifferentRank' };
    case 'allSameColor':
      return { type: 'allSameColor' };
    case 'color': {
      const color = parseColor(global['color'], `${path}.color`, p);
      return color === undefined ? undefined : { type: 'color', color };
    }
    case 'colorCount': {
      const color = parseColor(global['color'], `${path}.color`, p);
      const count = p.number(global['count'], `${path}.count`);
      return color === undefined || count === undefined ? undefined : { type: 'colorCount', color, count };
    }
    case 'suitKinds': {
      const count = p.number(global['count'], `${path}.count`);
      return count === undefined ? undefined : { type: 'suitKinds', count };
    }
    case 'suitCount': {
      const count = p.number(global['count'], `${path}.count`);
      return count === undefined ? undefined : { type: 'suitCount', count };
    }
    default:
      return p.at(`${path}.type`, '知らない条件');
  }
}

function parseColor(value: unknown, path: string, p: Problems): CardColor | undefined {
  if (value === 'red' || value === 'black') return value;
  p.at(path, 'red か black ではない');
  return undefined;
}

function parseWild(value: unknown, path: string, p: Problems): WildRule | undefined {
  const wild = p.object(value, path);
  if (!wild) return undefined;
  const selector = parseSelector(wild['cards'], `${path}.cards`, p);
  if (!selector) return undefined;

  const becomes = wild['becomes'];
  if (becomes === undefined) return { cards: selector };

  const limits = p.object(becomes, `${path}.becomes`);
  if (!limits) return { cards: selector };
  return {
    cards: selector,
    becomes: {
      ...optional(
        'ranks',
        limits['ranks'] === undefined
          ? undefined
          : p.each(limits['ranks'], `${path}.becomes.ranks`, rank(p)),
      ),
      ...optional(
        'suits',
        limits['suits'] === undefined
          ? undefined
          : p.each(limits['suits'], `${path}.becomes.suits`, suit(p)),
      ),
    },
  };
}

function parseSelector(value: unknown, path: string, p: Problems): WildSelector | undefined {
  const selector = p.object(value, path);
  if (!selector) return undefined;

  switch (selector['kind']) {
    case 'joker':
      return { kind: 'joker' };
    case 'rank':
      return { kind: 'rank', ranks: p.each(selector['ranks'], `${path}.ranks`, rank(p)) };
    case 'card':
      return {
        kind: 'card',
        cards: p.each(selector['cards'], `${path}.cards`, (item, at) => {
          const card = p.object(item, at);
          if (!card) return undefined;
          const r = rank(p)(card['rank'], `${at}.rank`);
          const s = suit(p)(card['suit'], `${at}.suit`);
          return r === undefined || s === undefined ? undefined : { rank: r, suit: s };
        }),
      };
    default:
      return p.at(`${path}.kind`, 'joker / rank / card のいずれかではない');
  }
}

const SHOW_CARDS: readonly ShowCardsPolicy[] = ['none', 'one', 'any'];

function parseRuns(
  value: unknown,
  path: string,
  p: Problems,
): { readonly max: number } | undefined {
  if (value === undefined) return undefined;
  const runs = p.object(value, path);
  if (!runs) return undefined;
  const max = p.number(runs['max'], `${path}.max`);
  return max === undefined ? undefined : { max };
}

function parseOptions(value: unknown, path: string, p: Problems): TableOptions | undefined {
  if (value === undefined) return undefined;
  const options = p.object(value, path);
  if (!options) return undefined;

  const num = (key: string) => optional(key, p.optionalNumber(options[key], `${path}.${key}`));
  const bool = (key: string) => optional(key, p.optionalBoolean(options[key], `${path}.${key}`));

  return {
    ...num('exposedCardChance'),
    ...bool('misdeal'),
    // 前の版の「ミスディールの確率」。0 より大きければ「2枚目もありうる」として読む。
    ...(typeof options['misdealChance'] === 'number' && options['misdealChance'] > 0 && options['misdeal'] === undefined ? { misdeal: true } : {}),
    ...bool('exposedCardBecomesBurn'),
    ...bool('rabbitHunt'),
    ...optional('runItTwice', parseRuns(options['runItTwice'], `${path}.runItTwice`, p)),
    ...optional(
      'showCards',
      options['showCards'] === undefined
        ? undefined
        : p.literal<ShowCardsPolicy>(options['showCards'], `${path}.showCards`, SHOW_CARDS),
    ),
  };
}
