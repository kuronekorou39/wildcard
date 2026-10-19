# Wildcard — アーキテクチャ

旧3プロジェクトが合流できなかった原因はただ一つ、**ゲームロジックが通信層と絡まっていたこと**である。
`poker-web-test` の `PokerGame.ts` は socket 配信とコールバックに依存し、
`game-ui` の `server.js` は Express のハンドラ内にロジックが直書きされていた。
結果として「片方のUI + 片方のエンジン」という当然やりたかった組み替えができなかった。

Wildcard はこの一点を設計で封じる。

## 原則1 — エンジンは純粋関数である

```
reduce(state, action) -> state
```

エンジンは通信・時間・乱数の副作用を持たない。

- **通信を持たない**: socket も HTTP も知らない
- **時間を持たない**: 持ち時間切れは外から `{type:'timeout'}` という action として入る
- **乱数を外から受ける**: シャッフルは seed を引数で受ける（これによりハンドの完全再現とテストが可能になる）

## 原則2 — 秘匿はエンジンの責務である

```
project(state, viewerId) -> VisibleState
```

「誰に何が見えるか」をUIや通信層の判断に任せない。エンジンが視点ごとに state を伏せて返す。
自分のホールカードだけが見え、ショーダウンで初めて他人の札が開く。

これを分離しておくと、段階0（ブラウザ内）では `project` の結果だけをUIに渡すことで
**サーバーが無くてもホールカードの秘匿が成立する**（ソロ/ホットシートは「見せない」で足りる）。

## 原則3 — 同一エンジンを2箇所で回す

クライアントはエンジンを直接叩かず、`Transport` 越しに叩く。

```
                   ┌─────────────────────────┐
   UI (React)  ──> │  Transport (interface)  │
                   └───────────┬─────────────┘
                     ┌─────────┴─────────┐
            LocalTransport          RemoteTransport
          （同一タブ内でエンジン）   （WebSocketでサーバのエンジン）
                     │                   │
                     └──── 同じ engine ───┘
```

- 段階0 = `LocalTransport` のみをビルドして GitHub Pages に置く
- 段階1以降 = サーバーURLが設定されていれば `RemoteTransport` に切り替わる

UIから見てこの2つは区別できない。**オンライン対応は「差し替え」であって書き直しではない。**

## 原則4 — ルールは設定データである

遊び方をハードコードしない。`Variant` というデータを受け取って動く。

```
evaluate(hole, board, variant) -> HandResult
reduce(state, action)           // ストリートも手札の枚数も variant から読む
```

役の強さだけでなく、デッキの中身・手札の枚数・場の開き方・使用枚数の制約まで、
すべて `Variant` に入っている。標準のテキサスホールデムもオマハも、その一例に
すぎない。つまり「カスタムルール対応」は後付け機能ではなく、最初から唯一の経路。

4つの軸（デッキ / 構造 / ベッティング / 役）への分け方と、何をどこまで
データで表せるようにしたかは [variants.md](./variants.md) にある。

## ディレクトリ構成

```
wildcard/
├── docs/
│   ├── concept.md          用途・思想・段階計画
│   └── architecture.md     本ファイル
└── packages/
    ├── engine/             純粋TS。依存ゼロ。ここが資産の本体
    │   ├── src/
    │   │   ├── types.ts    ドメイン型とルール定義モデル
    │   │   ├── deck.ts     デッキ生成・シャッフル（seed式）
    │   │   ├── rules/      役評価（Variant を解釈する）
    │   │   ├── game/       進行の reduce（ベッティングラウンド、席順、ポット）
    │   │   └── project.ts  視点別の state 投影
    │   └── test/
    ├── client/             React + Vite。Pages にデプロイされる成果物（段階0）
    └── server/             WebSocket アダプタ（段階1以降・後回し）
```

`engine` が依存ゼロであることは意図的な制約である。これが守られている限り、
エンジンはブラウザでもNodeでもCLIでもテストランナー内でも同じように動く。

## 旧プロジェクトからの移植方針

| 移植元 | 対象 | 扱い |
|---|---|---|
| `poker-web-test` 未コミット分 | 時計回りの席順、プリフロップ開始位置（BB+1）、`isWaiting`（ハンド途中参加）、`isAway`（離席）と自動フォールド | **仕様として全部拾う**。コードは書き直す |
| `poker-web-test` | `PokerGame.ts` / `handEvaluator.ts` | 参考のみ。socket 依存のため流用しない |
| `poker-web-20250702` | `types/houseRules.ts` のルール定義モデル（変数ランク X/Y/Z を含む `CardCondition`） | **ほぼそのまま持ち込む**。旧形式互換の残骸は落とす |
| `poker-web-20250702` | `HouseRulesPage.tsx`（3,651行） | 設計意図のみ参考。単一ファイル肥大のため分割して作り直す |
| `game-ui` | `client/index.html` の卓レイアウトとCSS、自席を手前に回す座席回転ロジック | **移植する**。Reactコンポーネントに分解 |
| `game-ui` | `client/src/` のReactコンポーネント群 | 初回コミット以降未使用の死にコード。**破棄** |
| `game-ui` | `server/server.js` / `handEvaluator.js` | 参考のみ。流用しない |
