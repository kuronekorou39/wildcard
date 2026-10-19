# バリアントの設計

世の中のポーカーは「少しずつ違うルールの集まり」である。Wildcard の目標は、
それらを**組み合わせて作れる器**を用意すること。この文書は、何を軸として
切り出し、どこまでをデータで表現するかを決める。

## 原則

**エンジンのコードに「ホールデムならこう」という分岐を一切書かない。**

ホールデムもオマハも、ユーザーが作った名前のない変種も、すべて同じ
`Variant` というデータである。エンジンはそれを読んで動くだけで、
特定の遊び方を知らない。これは [architecture.md](./architecture.md) の
原則4 を、役だけでなくゲームの構造まで広げたもの。

## 4つの軸

```ts
interface Variant {
  id: string
  name: string
  description?: string
  deck: DeckRules          // 何で遊ぶか
  structure: HandStructure // どう配って、どう組むか
  betting: BettingRules    // どう賭けるか
  ranking: RankingRules    // 何が強いか
}
```

この4つは互いに独立している。デッキを変えても構造は影響を受けないし、
ベッティングを変えても役の判定は変わらない。だから組み合わせが効く。

### デッキ — 何で遊ぶか

```ts
interface DeckRules {
  suits: Suit[]          // 直積の素になるスート
  ranks: Rank[]          // 使うランク。**弱い順**に並べる
  suitRanking?: Suit[]   // スート間の強さ（強い順）。省略ならスートに強弱なし
  copies?: number        // 直積で作る各カードの枚数（既定1）
  overrides?: { rank: Rank; suit: Suit; count: number }[]  // カード単位の上書き
}
```

直積（スート × ランク × copies）を土台にして、`overrides` でカード単位に
上書きする。この2段構えなら、素直なデッキも極端に偏ったデッキも同じ型で書ける。

| やりたいこと | 書き方 |
|---|---|
| クラブだけ抜く | `suits` から `clubs` を外す |
| 2〜5 を抜く（ショートデッキ） | `ranks` から外す |
| 全部2枚ずつ | `copies: 2` |
| スペードのAを10枚 | `overrides: [{ rank:'A', suit:'spades', count:10 }]` |
| ハートのKだけ抜く | `overrides: [{ rank:'K', suit:'hearts', count:0 }]` |

`overrides` は `suits` に無いスートも足せる（スペードのみ + ハートのA、など）。
ただしランクは `ranks` に含まれていなければならない。強さの順序が決まらないため。

ジョーカーは段階2で入れる（→ ワイルドカード）。

`ranks` の並び順がそのままカードの強さになる。だから「TT が AA より強い」は
並べ替えるだけで実現する。

**ただし副作用がある。** ランクの並び順はストレートの意味も決めるので、
10 を A の上に移すと 9-10-J-Q-K はもう連続ではなくなる。
こういうことが起きるので、編集画面には必ず例示が要る。

### 構造 — どう配って、どう組むか

```ts
interface HandStructure {
  holeCards: number                    // 手札の枚数
  streets: Street[]                    // 場に開く段階
  handSize: number                     // 役を作る枚数（通常5）
  holeUsage?: { min: number; max: number }   // 手札から使う枚数
  boardUsage?: { min: number; max: number }  // 場から使う枚数
}

interface Street {
  name: string
  cards: number   // 開く枚数。0 でもよい（開かずに賭けるだけのラウンド）
  burn?: number   // 開く前に山札から落とす枚数（バーンカード）。既定0
}
```

使用枚数の制約を省略すると「何枚使ってもよい」になる。

| 遊び方 | holeCards | streets（開く/焼く） | holeUsage | boardUsage |
|---|---|---|---|---|
| テキサスホールデム | 2 | 3/1, 1/1, 1/1 | 省略（0〜2） | 省略 |
| オマハ | 4 | 3/1, 1/1, 1/1 | **{2,2}** | **{3,3}** |
| 6枚フロップ | 2 | **6**/1, 1/1, 1/1 | 省略 | 省略 |
| ファイブカードドロー | 5 | なし | {5,5} | {0,0} |

**バーンカードは結果の確率分布を変えないが、必要なデッキ枚数は変える。**
指定できないと「52枚きっかりで回るはず」の計算が狂うので、ルールとして持つ。

**デッキの枚数が足りているか**は `validateVariant` が確かめる。必要枚数は

```
holeCards × 人数 + Σ(各ストリートの 開く枚数 + 焼く枚数)
```

合わせて次も確かめる。

- `holeUsage.max + boardUsage.max >= handSize`（そもそも役を組めるか）
- `holeUsage.max <= holeCards`、`boardUsage.max <= 場の総枚数`
- `overrides` のランクが `ranks` に含まれているか

### ベッティング — どう賭けるか

```ts
interface BettingRules {
  limit: 'no-limit' | 'pot-limit' | 'fixed-limit'
  straddle?: { max: number }              // ストラドルの重ね回数
  streetCaps?: { street: number; noAllIn?: boolean; maxTotal?: number }[]
  maxRaisesPerRound?: number
}
```

**掛け金（SB/BB/アンティ）はここに入れない。** 「NLホールデム $1/$2」の
$1/$2 は遊び方ではなく卓の設定で、同じバリアントのまま変えられる必要がある。
額は `GameState` 側に置く。ここに入れるのは制度だけ。

`streetCaps` の `street` は `-1` がプリフロップ、`0` 以降が `streets` の index。
「プリフロップでオールイン禁止」は `{ street: -1, noAllIn: true }`。

**この軸は役の判定と完全に独立している。** 後から足しても何も壊れないので、
実装の順番は最後でよい。

### 役 — 何が強いか

```ts
interface RankingRules {
  hands: HandRanking[]   // 強い順
  wilds?: WildRule[]     // ワイルドカードの扱い
}
```

`HandRanking` の中身（`HandPattern`）は既存のものを引き継ぐ。
カードごとの条件と、手全体に課す条件の組み合わせ。

#### ランク条件の表現

```ts
type RankSpec =
  | { type: 'fixed'; value: Rank }                      // 特定のランク
  | { type: 'oneOf'; values: Rank[] }                   // いずれか
  | { type: 'variable'; name: string; offset?: number } // 変数。X, X+1 ...
  | { type: 'any' }
```

`oneOf` があると「素数ストレート（2,3,5,7,J,K のいずれか5枚）」のような役が
書ける。`variable` は同名なら同ランクを指し、異なる名前は異なるランクを指す。

#### ジョーカーとワイルドカード

```ts
interface WildRule {
  /** どのカードがワイルドか */
  cards: { kind: 'joker' } | { kind: 'rank'; ranks: Rank[] }
  /** 何に化けられるか。省略なら何にでも */
  becomes?: { ranks?: Rank[]; suits?: Suit[] }
}
```

ジョーカーも「2がワイルド」も同じ仕組みで表す。

**実装方針**: 素朴に「ワイルド1枚につき52通り」を試すと爆発する。
代わりに、**ワイルドは「どの条件にも当てはまるカード」として扱い、
実札より後に処理する**。実札が先に変数を束縛し、ワイルドは残った穴を
埋めるだけになるので、置換の総当たりが要らない。

## 実装の段階

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | Variant への移行、構造の一般化（手札N枚・ストリート・バーン・使用枚数・デッキのカード単位指定） | ✅ 完了 |
| 2 | ワイルドカードとジョーカー（`oneOf` と `allDifferentRank` は段階1で実装済み） | 未 |
| 3 | 例示生成とプレビュー | 未 |
| 4 | 編集画面 | 未 |
| 5 | ベッティング（ストラドル・上限・リミット制） | 未 |

段階1で遊べるようになったもの: オマハ（手札4枚・ちょうど2枚使用）、
フロップ6枚、カードを開かないベッティングラウンド、場の無いバリアント、
スペードのAを10枚のような偏ったデッキ、素数ストレートのような `oneOf` の役。

段階1が終わった時点で**オマハが実際に遊べる**ようにする。
書いただけで動かない設計を残さないため、各段階は遊べる形で区切る。

## 決めたこと・決めていないこと

決めたこと:

- 4つの軸は独立させる。組み合わせが効くのはこれが理由
- ランクの強さは `ranks` の並び順ひとつで表す。別の強さ表を持たない
- ストリートは名前と枚数の配列。フェーズ名をエンジンに焼き込まない
- ワイルドは置換の総当たりではなく、条件側で吸収する

決めていないこと:

- ドロー（カードの交換）— `streets` とは別の軸が要るので保留
- スタッド（表向きの手札）— カードごとの公開範囲が要る。`project` の拡張になる
- ハイロー split — ポットの分配規則が増える。`RankingRules` に low 用の順位表を
  足す形になりそうだが、必要になってから決める
