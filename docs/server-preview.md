# サーバー卓の検証

最大10席の卓を Cloudflare Workers + SQLite Durable Objects で進行・保存する検証用の実装。
2026-10-24 に無料プランへ配置した。2026-10-30 の方針では、現在のリポジトリを Pages の検証版として仕上げ、
アカウント・クラブ・持ち越しチップ等は別リポジトリの AWS ベースのサービスで扱う。
この文書は既存の Cloudflare 試作の操作・制限を説明する。タグ前の課題は [課題メモ](./preview-release-checklist.md) を参照。

## Pages から開く

[公開プレビュー](https://kuronekorou39.github.io/wildcard/)で、オンライン → サーバーを選ぶ。
接続先は `https://wildcard-table-preview.wildcard-server.workers.dev` を共通設定として配信する。
主催者は開始ボタン上の「サーバー接続」で作成キーを入力し、卓を作る。キーの入力状況を入口に表示する。
この開発PCでは作成キーを `packages/server/.dev.vars.production` に保存した（Git 対象外）。
`CREATE_KEY=` の右側だけを入力する。参加者は招待リンクから入ればよく、作成キーは不要。

配置時は無料プランの固定上限を使用。継続的な開催を始める際には、契約・使用量を確認して Workers のプランを見直す。
有料プランへ切り替える場合は、CPU 上限の設定も改めて決める。

### 公開URLと大量アクセス（2026-10-31確認）

接続先URLは秘密情報ではない。ブラウザの通信・公開クライアントから分かるため、
画面で値を隠すだけでは不正アクセスや利用量の増加を防げない。2026-10-31 から接続先URLは画面に出さず、配布時の設定（`VITE_TABLE_SERVER_URL`）だけで決める。参加者は招待リンク、作成者は作成キーだけを扱う。

現在のコードには作成キー、最大5卓、卓の有効期限、1卓24接続、WebSocketの操作頻度制限がある。
2026-10-31 に Workers の Rate Limiting バインディングで入口の回数制限を追加した（IPごと・60秒：卓の作成 5回、WebSocket 接続 40回、その他の HTTP 120回。同じ Wi‑Fi（同一IP）から10人が入り直しても足りる数。超過は 429 と理由を JSON で返す）。拠点ごとに別カウントの「ゆるい」制限で、厳密な上限ではない（公開後の実測では同時30回中1回しか弾かなかった）。そのため卓の作成だけは Worker のメモリでも IP ごとに 1分5回まで数えて 429 を返す。これも実行インスタンスごとの簡易なもので、セキュリティ境界ではない。作成キーの誤りは Worker で拒否するがリクエスト自体は到達し、1日の無料枠を消費する。
存在しないUUID形式の卓への問い合わせもDurable Objectに渡る。Origin制限はブラウザの他サイト利用を抑えるもので、直接のHTTPアクセスに対する認証ではない。

| 契約 | 大量アクセス時の影響 |
|---|---|
| Workers Free | Workerはアカウント合計10万リクエスト/日。超過で1027エラー。DOにも別の無料上限があり、超過した操作は失敗する。追加従量料金より、検証卓や同一アカウントの利用停止が問題になる |
| Workers Paid | 含有枠超過分は課金。Workerのリクエストは月1,000万件込み、追加100万件あたり$0.30。CPU、DOのリクエスト・稼働時間・保存等は別に計算する |

100万件が1日に来る場合、無料プランは途中で上限に達しうる。有料プランでも「100万件だけで必ず高額」ではなく、月の総量と到達先・処理量による。
2026-10-24の配置記録は無料プラン。この確認では契約・請求画面の再照合や課金プランの変更はしていない。

公開範囲を広げる前に、不要なDO呼び出しの抑制と使用量通知を追加する。WAF のレート制限は workers.dev には設定できず、カスタムドメインを付けた場合だけ使える（今回は見送り）。
有料化する場合はCPU上限も設定する。レート制限やCPU上限は請求総額の厳密な上限ではない。
非公開の検証に戻す場合はURLを隠すのでなく、入口のアクセス制御を設ける。

根拠：[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、
[Workersの1日上限](https://developers.cloudflare.com/workers/platform/limits/#daily-requests)、
[Durable Objects料金・無料上限](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

## ローカルで開く

Node.js 22 以上で、リポジトリ直下から実行する。

```powershell
npm install
npm run dev:server
```

別のターミナルで `npm run dev` を実行し、表示された Vite の URL を開く。
オンライン → サーバー → 名前を入力 → 卓を作る。席数・チップ・ブラインドは値を押して編集する。
ローカル用の接続先と作成キーは開発モードで設定済み。
卓の右上の情報ボタンから招待リンクをコピーし、別ブラウザで参加する。
開始・自動開始の停止・卓の終了は主催者だけが操作できる。

再読み込みすると同じ席と手札に戻る。同じ席を別タブで開くと古いタブを切断する。
接続資格はブラウザ内に保存するため、別端末への引き継ぎやデータ消去後の復旧はまだできない。
招待リンクには接続資格や作成キーを含めない。参加リンクを知っている人は空席に参加できる。
リンクの失効・参加承認はクラブ段階で加える。

卓の情報 → 保存したハンドから、結果・各手順の盤面・チップの移動を確認できる。
終了した卓も、元の招待リンクを同じブラウザで開けば保存期間内は記録を閲覧できる。
初期設定では1卓あたり直近100ハンド、作成から7日間を保存する。
全員が退出しても即削除せず、再接続で保存期限を延長しない。「卓を終了」は開催を止める操作で、記録の即時削除ではない。
ブラウザ内の再接続情報には現状、自動的な期限切れ削除がない。端末に情報が残ることと、サーバー上で卓が有効であることは別。
卓情報に保存期限・開催状態を表示する。期限切れ・削除済みが確認された卓では再接続を止め、確認後に端末内の参加情報を削除できる。
期限をまたいだハンドは最後まで進め、次のハンドと新規参加を止めてから削除する。
この場合は最終処理後、最大約1時間の削除猶予を持つ。

## 進行と保存

| 対象 | 実装 |
|---|---|
| 卓の進行 | 1卓1 Durable Object。要求を直列化し、共通エンジンで検証・適用 |
| 席の識別 | ブラウザで生成した256ビットの資格をサーバーでハッシュ化し、席と対応付ける |
| 操作 | 操作ID・連番・ハンドID・手番IDを照合。再送は同じ受領結果を返す |
| 永続化 | 状態・受領結果・ハンド記録・次の alarm を同一トランザクションで保存後に配信 |
| 時計 | 手番の期限と自動開始時刻を保存。alarm と復元時の判定で進む |
| 切断 | 現在のハンドは期限切れのチェック／フォールドで進む。次のハンドは接続している着席者が2人以上必要 |
| 非公開情報 | 配信と履歴閲覧の両方で `project` を通す。山札・未公開の他人の札・乱数を配信しない |
| 配牌 | サーバーの Web Crypto による乱数列。P2P の32ビット seed 方式とは別 |
| 待機 | WebSocket Hibernation と自動 ping 応答を使用。ポーリングやプロセス内タイマーで卓を起こし続けない |

主催者も自分の視点だけを受け取る。ただしサーバー運営者が全状態を扱う構成であり、
参加者が配牌を暗号学的に監査する仕組みは含まない。
保存済み内部状態には非公開カードがあるので、管理者用データを公開履歴として配信しない。

検証用の制限は全体5卓、1卓10席・観戦を含め20名、同時接続24本。
作成には共通の作成キーが必要。1接続からの操作頻度、メッセージ量にも制限を置く。
これらは利用量の制限であり、クラウド請求の完全な上限を保証するものではない。

## 確認コマンド

```powershell
npm test
npm run typecheck
npm run build
npm run build:server
npm run verify:server
npm run soak --workspace @wildcard/server
```

`build:server` は dry-run で公開しない。
`verify:server` は一時領域の Miniflare で実通信・10人着席・再送・切断・プロセス再起動・履歴を確認する。
`soak` は10人の稼働卓2つと待機卓1つを1時間動かし、`packages/server/shots-server/soak.json` に計測値を保存する。
いずれも独立したローカル環境で、通常の開発卓には触れない。

短い反復試験は PowerShell で次のように実行できる。

```powershell
$env:WILDCARD_SOAK_MINUTES = '2'
npm run soak --workspace @wildcard/server
Remove-Item Env:WILDCARD_SOAK_MINUTES
```

ブラウザの確認には Vite と `dev:server` を起動した状態で次を実行する。

```powershell
npx playwright install chromium
npm run drive:server --workspace @wildcard/client
npm run drive:workspace --workspace @wildcard/client
```

作成・招待参加・10人対局・ページ再読み込み・保存履歴・卓の終了を通し、
`packages/client/shots-server` にスマホ／デスクトップの画像を出す。

## 公開環境への配置

公開先は Cloudflare とする。卓ごとの更新・永続化・期限処理・休止可能な WebSocket を
同じ実行環境にまとめられるため、最初の運営検証に採用した。
小型の常駐サーバー案と比べ、プロセス管理・再起動・期限起動を自前で組む範囲を減らせる。
クラブの認証・画像・長期履歴まで Cloudflare に固定したという意味ではない。
[Durable Objects の構成](https://developers.cloudflare.com/durable-objects/get-started/)と
[WebSocket の休止](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)を参照。

このPCの Wrangler は Cloudflare アカウントに認可済み。他の環境から公開する場合は、利用するアカウントでログインする。
無料枠での配置自体は可能だが、上限超過で操作が失敗するため、継続開催の検証では有料枠と使用量を確認する。
価格と試算は [server-measurement.md](./server-measurement.md) を参照。

1. `packages/server` で `npx wrangler login`、続けて `npx wrangler whoami` で配置先を確認する。
2. `wrangler.jsonc` の `ALLOWED_ORIGINS` を公開画面の origin に設定する。現在の Pages なら `https://kuronekorou39.github.io`。パスは含めない。
3. `npx wrangler deploy` で配置する。まだ作成キーがないため、この時点では新規卓を作れない。
4. `npx wrangler secret put CREATE_KEY` で検証用の作成キーを対話入力する。開発用の `local-preview-only` は公開環境で使わない。キーをリポジトリや `VITE_` 環境変数に入れない。
5. 画面の「サーバー接続設定」に配置先 URL を設定する。主催者だけ作成キーを入力する。招待される人にも同じ接続先が必要。
6. 共通の接続先を配信する場合、GitHub の Repository variable `WILDCARD_TABLE_SERVER_URL` に公開 URL を設定して Pages を再ビルドする。これは公開可能な URL であり、秘密情報ではない。

公開済みの環境へブラウザ試験を行うには、PowerShell で次のように接続先を指定する。
作成キーの内容はログへ出力しない。

```powershell
$env:WILDCARD_URL = 'https://kuronekorou39.github.io/wildcard/'
$env:WILDCARD_SERVER_URL = 'https://wildcard-table-preview.wildcard-server.workers.dev'
$env:WILDCARD_CREATE_KEY_FILE = 'C:\projects\wildcard\packages\server\.dev.vars.production'
npm run drive:server --workspace @wildcard/client
Remove-Item Env:WILDCARD_URL, Env:WILDCARD_SERVER_URL, Env:WILDCARD_CREATE_KEY_FILE
```

招待リンクだけで別サーバーへ資格を送ることはない。接続先は共通設定か、本人が接続設定で指定した URL を使用する。
Pages の配信と Worker の配置は独立している。Pages の workflow ではサーバーのビルドとローカル通信試験までを行う。

## Cloudflare 試作に残る確認

以下は実施済みではない。AWS版へ引き継ぐ参考項目とし、すべてをCloudflareで完遂することはPages版のタグ条件にしない。
既存の公開試作を今後も運営・拡大する場合は、その範囲に必要な確認を行う。

- 実際の別端末・モバイル回線で10人卓を進め、切断からの復帰と Worker 更新後の復元を確認する。
- 同時卓・待機卓を含めて課金対象のリクエスト、GB-s、SQLite 読み書き、保存量を管理画面で記録する。
- 作成期限をまたぐ最終ハンド、卓の削除、作成枠の回収を実環境でも確認する。
- 複雑なカスタムルールを含め、CPU 時間・応答速度の許容範囲を決める。
- 請求の通知を設定し、検証用の作成キーを限定して共有する。

アカウント・クラブ所属・招待失効・チップ台帳は、新しいAWSプロジェクトで進める。
この試作の接続資格を、恒久的なユーザーアカウントとして流用しない。
