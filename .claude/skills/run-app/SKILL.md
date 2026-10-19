---
name: run-app
description: Wildcard のクライアントを実際のブラウザで起動して操作し、スクリーンショットを撮る。UIを変えたとき、遊べるかを確かめたいとき、見た目の崩れを確認したいときに使う。
---

# Wildcard を実際に動かす

テストは「落ちない」ことまでしか見ない。卓が潰れて消える、カードが読めない、
手番が進まない——この種の不具合はブラウザで動かさないと分からない。

## 1. 開発サーバーを立てる

```bash
cd packages/client && npx vite --port 5173 --strictPort > /tmp/vite.log 2>&1 &
sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
```

`200` が返れば起動している。

> **注意**: バックグラウンド実行のあとシェルの作業ディレクトリが戻る。
> 続きのコマンドでは必ず `cd packages/client` をやり直すこと。

## 2. 実際に1ハンド遊ばせる

```bash
cd packages/client && node scripts/drive.mjs
```

セットアップ画面 → 3人で着席 → ゲーム開始 → 目隠しを押しながら
ショーダウンまで遊びきり、`packages/client/shots/` にスクリーンショットを残す。

**撮った画像は必ず Read で開いて目で見ること。** 真っ暗なら起動に失敗している。

出力で特に見る行:

| 行 | 意味 |
|---|---|
| `目隠し中の卓の要素数: 0` / `カード要素数: 0` | ホットシートの秘匿が成立している。0 以外なら次の人のカードが DOM に載っている |
| `自分の見えるカード枚数: 2` | 自分の手札が見えている |
| `他人の裏向きカード枚数` | 他人の手札が伏せられている |
| `[browser error]` / `[page error]` | コンソールエラー。出たら直す |
| `--- ショーダウン ---` | 1ハンド通しで遊べている |

環境変数で挙動を変えられる。

- `WILDCARD_URL` … 接続先（既定 `http://localhost:5173/`）
- `WILDCARD_SHOTS` … スクリーンショットの出力先（既定 `shots/`）
- `WILDCARD_BROWSER` … 使う Chromium の実行ファイルパス

## 2b. 役の順位表を見る

```bash
cd packages/client && node scripts/drive-rules.mjs
```

ルールを切り替えながら順位表を開き、各役の**例の札を aria-label で読み上げて**
出し、`shots/rules-N.png` を残す。例の生成はエンジン側でテストしてあるが、
「読めるか」は画面を見ないと分からない（→ docs/variants.md 段階4）。

`WILDCARD_VARIANTS` に `,` 区切りで**画面に出ている名前のまま**渡す
（`ショートデッキ（6+）` のように括弧まで含める）。

## 3. 終わったらサーバーを止める

`pkill` ではこの環境の Vite を落としきれないことがある。PowerShell で確実に止める。

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*5173*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## ブラウザの用意

初回だけ必要。

```bash
npx playwright install chromium
```

**Playwright のバージョンは 1.49.1 に固定してある。** この環境の Node は 18.15.0 で、
1.5x 以降は Node 20 以上を要求して動かない。上げるなら Node ごと上げること。

Edge を `channel: 'msedge'` で使う手は試したが、起動直後に接続が切れて使えなかった。
`npx playwright install chromium` で入る専用ビルドを使うこと。

## つまずいたときの勘所

**卓が消える / Playwright が `hidden` と言う**
`.table-area` のサイズは必ず「幅起点 + `aspect-ratio`」で決める。高さが flex で
後から決まる `.table-wrap` に対して `height: 100%` を指定すると解決できず、
要素が潰れて卓ごと消える。一度これで踏んでいる。

**ボタンが見つからない**
`getByRole('button', { name: 'レイズ' })` は「〜にレイズ」にも一致する。
`exact: true` を付けるか正規表現で先頭を縛る。
