# Wildcard

**ルールを自分で決めるポーカー。** 身内のホームゲームのための、カードの強さと役そのものを定義できるテキサスホールデム。

- 思想・用途・段階計画 → [docs/concept.md](./docs/concept.md)
- 設計 → [docs/architecture.md](./docs/architecture.md)

## 現在の状態

段階0（サーバー不要で遊べる静的版）を実装中。

| パッケージ | 内容 | 状態 |
|---|---|---|
| `packages/engine` | ゲームエンジン（純粋TS・依存ゼロ） | デッキと役評価は完了。進行の reduce が未実装 |
| `packages/client` | React + Vite の卓UI | 未着手 |
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

## 開発

```bash
npm install
npm test          # エンジンのテスト（53件）
npm run typecheck
npm run bench --workspace @wildcard/engine   # 役評価の速度
```

## なぜ GitHub Pages で「対戦」ではないのか

ポーカーは「サーバーだけがホールカードを知っている」構造が必須だが、GitHub Pages は静的配信のみで
WebSocket サーバを動かせない。そのため Pages に置くのはサーバー不要のモード（ソロ・ホットシート）に限る。
ただしそこで動くエンジンは、オンライン対戦時にサーバーで動かすものと同一コードである。
詳細は [docs/architecture.md](./docs/architecture.md) の原則3。
