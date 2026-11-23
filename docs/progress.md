# 進み具合

最終更新: 2026-11-24（ステップ4の完了）

## いまどこ

- ステップ1（オウム返しボット）… 完了。実際のLINEで確認済み
- ステップ2（在庫API + D1のテーブル + `pnpm run simulate`）… 完了。`main` にマージしてプッシュ済み。本番D1も作成・マイグレーション済み
- ステップ3（LIFFの在庫編集画面 + リッチメニュー）… 完了。再デプロイ、リッチメニューの設定、LINE上とD1での動作確認まで済み（2026-11-23）。`main` にマージ・プッシュ済み
- ステップ4（チャットでの献立相談）… 完了。本物のGemini APIで確かめ、本番にデプロイし、LINEアプリに提案が届くことを確認した（2026-11-24）。`main` にマージ・プッシュ済み
- 次はステップ5（毎朝9時のPush）。ステップ4の提案の流れ（`handlers/suggest.ts` の `suggestionText`）を再利用する

| ステップ | 内容 | 状態 |
| --- | --- | --- |
| 1 | オウム返しボット（Webhook + 署名検証 + Reply） | 完了 |
| 2 | 在庫API + D1のテーブル | 完了（`main` にマージ・プッシュ済み。本番D1の作成とマイグレーションも済） |
| 3 | LIFFの在庫編集画面 + リッチメニュー | 完了（LINE上とD1で動作確認済み。`main` にマージ済み） |
| 4 | チャットでの献立相談（Gemini接続） | 完了（本番で、LINEアプリへの提案の受信を確認済み） |
| 5 | 毎朝9時のPush | 未着手 |

## ステップ2で作ったもの

- `migrations/0001_create_pantry_items.sql`: `pantry_items`（CLAUDE.md のデータ定義どおり。user_id にインデックス）
- `src/clients/d1.ts`: 一覧・追加・削除。どれも `user_id` で絞る
- `src/core/pantry.ts`: 在庫の型と入力検証（名前1〜50文字、メモ200文字まで、カテゴリは food / seasoning）
- `src/clients/line.ts` の `verifyIdToken`: LIFFのIDトークンをLINEのサーバーで検証し、ユーザーID（sub）を返す
- `src/handlers/auth.ts`: `/api/*` 全体にかかるミドルウェア。検証したユーザーIDだけを `c.var.userId` に入れる
- `src/handlers/pantry.ts`: `GET /api/pantry`、`POST /api/pantry`（201）、`DELETE /api/pantry/:id`（204、他人の在庫と存在しない在庫はどちらも404）
- `scripts/simulate.ts`: 正しい署名（期待200）とでたらめな署名（期待401）の擬似Webhookを送る
- テスト67件（ステップ1の15件を含む）。D1は本物のローカルD1、LINEへの通信はモック
- `docs/design.md`: 現状の設計書（構成図、モジュール依存図、シーケンス図、ER図、API仕様、ファイル一覧）
- `scripts/check-docs.ts`（`pnpm run check:docs`）: 設計書のファイル一覧・依存図・ER図を実物と突き合わせる。ステップ完了時のルールは CLAUDE.md に書いた

## ステップ3で作ったもの

- `public/liff/`: 在庫編集画面（素のHTML + JS）。一覧（食材・調味料）、追加フォーム、削除（2回押し）
- `wrangler.jsonc` の `assets`: `public/` をそのまま配信する（`/liff/*` はWorkerのコードを通らない）
- 画面は `Authorization: Bearer <IDトークン>` だけを送る。IDトークンの期限が近いと、ログインし直す
- `test/liff-view.test.ts` と `test/liff-screen.test.ts`: 表示ロジックと、画面ファイルの中身（XSS対策、ユーザーIDを送らない、LIFF IDの形式、入力上限）
- `scripts/check-docs.ts` の対象に `public/` を追加

## ステップ4で作ったもの

- `src/core/suggest.ts`: 提案の出力スキーマ（`zod/mini`）、プロンプトの組み立て、返信の整形、定型文（在庫が空、失敗）。同じスキーマから、Geminiに渡すJSONスキーマも作る
- `src/clients/gemini.ts`: `generateJson`。`generateContent` を呼び、JSONで受ける。キーはヘッダで送る
- `src/handlers/suggest.ts`: 在庫の取得 → Gemini → 検証 → Reply の流れ。`suggestionText` は、失敗してもお詫びの文面を返す（ステップ5で再利用する）
- `src/handlers/webhook.ts`: オウム返しをやめ、先に200を返して、提案を応答のあとで行う（`waitUntil`）。1対1のテキストだけ扱う
- `scripts/try-gemini.ts`（`pnpm run try:gemini`）: 本番と同じ関数で、本物のAPIを1回呼ぶ確認用
- 環境変数: `GEMINI_API_KEY`（秘密）、`GEMINI_MODEL`（`wrangler.jsonc` の `vars`。いまは `gemini-3.8-flash`）
- テスト121件（ステップ3までの77件を含む）。Geminiは `fetch` スタブとモジュールのモック、D1は本物
- Workerのサイズ: 157KiB / gzip 38KiB（`wrangler deploy --dry-run`。ステップ3時点は 69KiB / gzip 18KiB）
- ローカルで `wrangler dev` を起動し、署名付きの擬似Webhookで、`waitUntil` の動作、D1の取得、Geminiの呼び出し、失敗時のお詫びまで通ることを確かめた（キーはダミー。Googleは `API_KEY_INVALID` を返した）
- 追加の依存は `zod` 4.6.7 のみ（承認済み）

## 決めたこと

- 画面は静的アセットで配信し、Honoの `/liff/*` ルートは作らない。コードを増やさず、Workerを通らないため
- LIFF ID は `public/liff/index.html` の `<meta>` に置く。公開される値で、環境変数にする理由がない
- 描画は `textContent` だけ。HTMLを文字列で差し込むAPIはテストで禁止
- 削除は誤タップ防止のため2回押し（1回目で「本当に削除」、3秒以内にもう一度）
- リッチメニューはコードにしない。画像が要り、作成にはアクセストークンを使うスクリプトが要るため。LINE Official Account Manager で設定する
- `tsconfig.json` に `allowJs` を足した（テストから画面のJSを読み込むため）。画面のJS自体は型検査しない
- 追加の依存はなし（ステップ3の時点）
- zod は軽量版の `zod/mini` を使う。通常版は gzip で約93KB増えるが、軽量版は約12KB（いまのWorker全体は gzip で約18KB）
- Geminiの出力は、検証に通ったものだけを使う。通らなければお詫びを返す（そのまま送らない）
- 提案は最大3品。料理名、理由、使う在庫、足りないもの（最大3つ）。文字だけで返す
- 在庫が空なら、Geminiを呼ばずに登録をうながす
- 利用者の文字は、`< >` と改行を除き、希望は200文字、在庫は100件で切ってからプロンプトに入れる（区切りの偽装を防ぐ）
- グループ・ルームの発言には答えない。1対1のトークだけ
- 利用回数の制限は、まだ入れない（友だち追加した誰でもGeminiを呼べる）。必要になったら、D1に表を足す形で相談する
- `generateContent` を使う。公式の資料は Interactions API に移りつつあるが、従来のAPIも載っている。JSON出力の指定名が資料によって違う（`responseJsonSchema` と `responseFormat.text.schema`）ため、`responseMimeType` + `responseJsonSchema` の形にした。**本物のAPIで通るかは、`try:gemini` で確かめる**。通らなければ、`clients/gemini.ts` だけを直す
- `src/core/suggest.ts` だけ、import に `.ts` を付ける（`scripts/try-gemini.ts` が Node で直接読み込むため）

- トークンはIDトークン（`liff.getIDToken()`）を `Authorization: Bearer` で送る。アクセストークンだと検証とプロフィール取得で2回LINEを呼ぶため
- 認証は `app.use("/api/*", ...)` で全体にかける。今後 `/api/*` にルートを足しても、検証を通らずには届かない
- 検証できなかった（LINEの障害など）ときは401にせず例外（500）にする。400だけを「不正なトークン」として扱う
- 在庫の入力検証は手書きのまま（`parsePantryInput`）。ステップ4で zod/mini を入れたが、置き換えてはいない（入力は3項目だけで、動いているため）
- 新しい環境変数は `LIFF_CHANNEL_ID`（LIFFを載せたLINEログインチャネルのID）。`.dev.vars.example` に追記済み
- 在庫IDは整数の自動採番。画面で重複する名前も許す

- 設計書の更新は、ステップ完了時に行う（CLAUDE.md「ステップ完了時」）。`check:docs` は `pnpm run check` には含めていない。作業の途中で落ちるのを避けるため
- `@types/node` は入れず、`scripts/node-shims.d.ts` に使う分だけの型宣言を置いた。入れるなら依存追加なので相談してから

## ハマったこと

- **`database_id` を変えると、ローカルのD1は別の空のデータベースになる**: ローカルの保存先がIDごとに分かれるため、`no such table: pantry_items` になった。`pnpm run db:migrate:local` で作り直す
- **ダミーのキーでは、リクエストの形は確かめられない**: Googleはキーを先に確認して `API_KEY_INVALID`（400）を返す。形の確認は、本物のキーでの `try:gemini` が必要
- **Nodeで `src/` を直接読み込むと、拡張子なしの import が解決できない**: 確認用スクリプトが `core/suggest.ts` を読むため、そのファイルだけ `./pantry.ts` と書く。`tsconfig.json` に `allowImportingTsExtensions` を足した
- **`process.exit()` は `never` 型ではない**: 後続の型の絞り込みが効かない。`process.exitCode` を使い、`if / else` にした
- **検証を外しても通るテスト**: 「想定外の形ならお詫び」のテストが、形が壊れた入力だと `formatReply` が例外を投げて、同じお詫びになっていた。形は近いが上限を超える入力（料理名41文字）に変えて、検証の有無を区別できるようにした。コードを壊して落ちることを確かめる作業で気づいた
- **送信者のIDを固定しても通るテスト**: 「他のユーザーの在庫を使わない」のテストが、送信者と同じIDを固定しても通っていた。別のユーザーが送るケースに変えた

- **テスト環境の `SELF` は静的アセットを返さない**: `assets` を設定しても404になる（Honoの404）。配信は `wrangler dev` で確かめ、テストは画面ファイルの中身の検査にした
- **ヘッドレスChromeは幅が約500px未満にできない**: 390pxで撮ると右が切れて見える。500pxで撮り直した
- **検査がコメントの文言を拾う**: 「HTML差し込みAPIを使わない」のテストが、コメント中の語に反応した。コメントの言い回しを変えた（検査はソース全体への単純な一致）

- **setupFiles が vi.mock を無効にする**: セットアップで `cloudflare:test` を読み込むとWorker本体が本物のclientsごとキャッシュされ、テストのモックが効かず、本物のLINE APIを叩いた。`resetDb()` をテストから呼ぶ形にし、`blockNetwork()` で外部通信を失敗させるようにした
- **GETにボディ**: テストで `Request` にGETのボディを付けると例外になる
- **D1のマイグレーションをテストで適用する**: `readD1Migrations` を `vitest.config.ts` で読み、`TEST_MIGRATIONS` として渡して `applyD1Migrations` で適用する。`exec` に複数行のSQLを渡す方法は使えない

## 人間がやること

残り:

- **漏れたAPIキーの無効化**: ステップ4の確認中に、Gemini APIキーがチャットに貼られた。AI Studio で、そのキーを削除して作り直したか確認する（本番の `GEMINI_API_KEY` が新しいキーかも）
- **費用の見張り**: AI Studio の利用状況を、ときどき見る。利用回数の制限（1人あたり）は、まだ入れていない。入れるなら、D1に表を足す形で相談する
- **モデルの見直し**: いまは `gemini-3.8-flash`（`wrangler.jsonc` の `GEMINI_MODEL`）。費用を抑えるなら、`gemini-3.5-flash-lite` を `try:gemini` で比べてから差し替える
- `pnpm install` 時のビルドスクリプト警告（esbuild / workerd）を消すなら `pnpm approve-builds`

済:

- 本番D1の作成とマイグレーション（2026-11-23）。`wrangler d1 create` の「設定を自動追加しますか？」には `n` と答える（バインディング名が `kondate_bot` になり、コードの `env.DB` と合わなくなるため）
- デプロイ（`https://kondate-bot.<サブドメイン>.workers.dev`）。初回は、アップロード直後の確認で `10007 This Worker does not exist` と出て失敗したが、同じコマンドの再実行で通った（反映待ちと見ている）
- 本番の秘密の登録（`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`GEMINI_API_KEY`）と、LINEの Webhook URL の付け替え
- LINEログインチャネルの作成とLIFFアプリの登録（スコープは `openid`。Messaging API と同じプロバイダー）、`LIFF_CHANNEL_ID` の設定（秘密ではないので `wrangler.jsonc` の `vars`。`.dev.vars` に空で書くと上書きされる）
- リッチメニューの設定（LINE Official Account Manager。リンク先は `https://liff.line.me/<LIFF ID>`）
- LINE上での動作確認（在庫の表示・追加・削除、献立の提案）
- ステップ1〜3のブランチのプッシュと、`main` へのマージ
- `GEMINI_API_KEY` の本番への登録と、`pnpm run try:gemini` での確認
