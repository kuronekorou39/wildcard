# Wildcard

**ルールを自分で決めるポーカー。** 身内のホームゲームのための、カードの強さと役そのものを定義できるテキサスホールデム。

**▶ 遊ぶ: https://kuronekorou39.github.io/wildcard/**

- 思想・用途・段階計画 → [docs/concept.md](./docs/concept.md)
- 設計 → [docs/architecture.md](./docs/architecture.md)

## 現在の状態

段階0（サーバー不要で遊べる静的版）を実装中。

| パッケージ | 内容 | 状態 |
|---|---|---|
| `packages/engine` | ゲームエンジン（純粋TS・依存ゼロ） | 完了（役評価・進行・ポット分配・視点投影） |
| `packages/client` | React + Vite の卓UI | ホットシートで遊べる。CPU相手とルールエディタが未実装 |
| `packages/server` | WebSocket アダプタ（段階1以降） | 未着手 |

### 役評価について

エンジンは「フラッシュ」「ストレート」といった概念を一切持たない。役の定義は
すべて `RuleSet` というデータから読む。標準のテキサスホールデムも
`STANDARD_RULESET` というプリセットに過ぎず、以下はすべてデータの差し替えで実現される。

- 役の有効・無効の切り替えと順位の入れ替え
- カードの強さ順の差し替え（A を最弱にする、2 を最強にする）
- スート間の強弱（同ランクのタイブレーク）
- カスタム役の追加（変数ランクで `X, X, Y, Y+1, Y+2` のように条件を書ける）
- 変則デッキ（スートを減らす、ショートデッキ）

### 進行について

`reduce(state, action)` の純粋関数で、通信も時間も乱数も持たない（原則1）。
持ち時間切れは外から渡される `timeout` アクションであり、シャッフルの乱数は
`startHand` の seed なので、同じ seed からハンドを完全に再現できる。

「誰に何が見えるか」は `project(state, viewerId)` がエンジン側で決める（原則2）。
UI や通信層に秘匿の判断をさせないので、サーバーのない段階0でもホールカードの
秘匿が成立する。

### 遊べるモード

| モード | サーバー | 状態 |
|---|---|---|
| ホットシート（1台を順番に回す） | 不要 | ✅ 遊べる |
| ソロ（CPU相手） | 不要 | 未実装 |
| オンライン対戦 | 必要 | 未実装（段階1以降） |

ホットシートでは手番が移るたびに目隠しを挟む。このとき卓そのものを描画しないので、
オーバーレイで覆う実装と違って DOM にも次の人のホールカードが載らない。

## 開発

```bash
npm install
npm run dev       # クライアントを起動
npm test          # 全テスト（エンジン137件 + クライアント26件）
npm run typecheck
npm run build     # 静的ビルド（packages/client/dist）
npm run bench     # 役評価の速度
```

`main` に push すると GitHub Actions が型チェック・テスト・ビルドを通して
GitHub Pages にデプロイする（`.github/workflows/deploy.yml`）。

### 実際に動かして確かめる

テストは「落ちない」ことまでしか見ない。遊べるかと見た目の崩れは実ブラウザで確かめる。

```bash
npx playwright install chromium   # 初回だけ
npm run dev                        # 別のターミナルで
npm run drive --workspace @wildcard/client
```

セットアップから1ハンド遊びきり、`packages/client/shots/` にスクリーンショットを残す。
手順の詳細とつまずきどころは `.claude/skills/run-app/SKILL.md` にまとめてある。

## なぜ GitHub Pages で「対戦」ではないのか

ポーカーは「サーバーだけがホールカードを知っている」構造が必須だが、GitHub Pages は静的配信のみで
WebSocket サーバを動かせない。そのため Pages に置くのはサーバー不要のモード（ソロ・ホットシート）に限る。
ただしそこで動くエンジンは、オンライン対戦時にサーバーで動かすものと同一コードである。
詳細は [docs/architecture.md](./docs/architecture.md) の原則3。
