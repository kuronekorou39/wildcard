# Wildcard

**ルールを自分で決めるポーカー。** 身内のホームゲームのための、カードの強さと役そのものを定義できるテキサスホールデム。

- 思想・用途・段階計画 → [docs/concept.md](./docs/concept.md)
- 設計 → [docs/architecture.md](./docs/architecture.md)

## 現在の状態

段階0（サーバー不要で遊べる静的版）を実装中。

| パッケージ | 内容 | 状態 |
|---|---|---|
| `packages/engine` | ゲームエンジン（純粋TS・依存ゼロ） | 着手 |
| `packages/client` | React + Vite の卓UI | 未着手 |
| `packages/server` | WebSocket アダプタ（段階1以降） | 未着手 |

## 開発

```bash
npm install
npm test          # エンジンのテスト
```

## なぜ GitHub Pages で「対戦」ではないのか

ポーカーは「サーバーだけがホールカードを知っている」構造が必須だが、GitHub Pages は静的配信のみで
WebSocket サーバを動かせない。そのため Pages に置くのはサーバー不要のモード（ソロ・ホットシート）に限る。
ただしそこで動くエンジンは、オンライン対戦時にサーバーで動かすものと同一コードである。
詳細は [docs/architecture.md](./docs/architecture.md) の原則3。
