# 献立LINEボット

## 概要

家にある食材・調味料をもとに、今晩の献立を提案するLINEボット。

- 在庫の登録・編集は、LINE内で開く画面（LIFF）で行う
- 毎朝9時（JST）に、在庫をもとにした3品をPushで提案する
- チャットで気分を伝えると、それに合う料理をReplyで提案する

## スタック

- TypeScript / Cloudflare Workers / D1
- Hono（HTTPルーティング）
- LINE Messaging API / LIFF
- Gemini API（Flash系。モデルIDは環境変数 GEMINI_MODEL）
- Vitest（Cloudflare公式のWorkers用テストプラグイン `@cloudflare/vitest-plugin`）/ zod
- Biome（lint + 整形。Markdownは対象外）
- 型定義は `@cloudflare/workers-types`
- pnpm（パッケージ管理）

## 入口

| 入口                                      | 役割                                |
| ----------------------------------------- | ----------------------------------- |
| POST /webhook                             | LINEからのメッセージ受信            |
| GET /liff/*                               | 在庫編集画面の配信（素のHTML + JS） |
| GET/POST /api/pantry, DELETE /api/pantry/:id | 画面から呼ぶ在庫API（Authorization: Bearer <LIFFのIDトークン>） |
| scheduled（cron: `0 0 * * *` = 9:00 JST） | 毎朝の献立Push                      |

## ディレクトリ

- src/index.ts … Honoのルート定義と scheduled。処理は書かない
- src/env.ts … 環境変数（Env）の型
- src/handlers/ … 各入口の処理（webhook.ts / auth.ts（/api/* のトークン検証）/ pantry.ts）
- src/core/ … 純粋な関数と型（いまは在庫の入力検証 pantry.ts。献立ロジックもここ。外部APIを呼ばない）
- src/clients/ … LINE / Gemini / D1 の薄いラッパー（いまは line.ts / d1.ts）
- migrations/ … D1のスキーマ（0001_create_pantry_items.sql）
- scripts/ … 開発用スクリプト（simulate.ts / check-docs.ts）
- test/ … テスト。helpers.ts に署名生成・DB初期化・外部通信ガード
- docs/design.md … 設計書（構成図、モジュール依存図、ER図、API仕様、ファイル一覧）
- docs/progress.md … 進み具合、決めたこと、ハマったこと
- .dev.vars.example … 環境変数の見本（本物の .dev.vars は各自で作る）

まだ無いもの（該当ステップで作る）:

- public/liff/ … 在庫編集画面

## データ

在庫（pantry_items）: id / user_id / name / category（food | seasoning）/ memo / created_at
数量と賞味期限は持たない。必要になったら相談してから足す。

## コマンド

- pnpm test … 単体テスト
- pnpm run check … 型チェック + lint
- pnpm run dev … ローカル起動
- pnpm run simulate … 擬似Webhookを送って動作確認（`LINE_CHANNEL_SECRET=... pnpm run simulate [URL] [本文]`。先に dev を起動する）
- pnpm run check:docs … 設計書（docs/design.md）と実物の突き合わせ
- pnpm run db:migrate:local … ローカルD1にマイグレーションを適用（本番は人間が実行）

## ルール

### 進め方

- 必ずブランチを作成して開発すること
- 動作確認で起動したプロセス（dev サーバーなど）は必ず止め、ポートが空いたことを確認してから報告する

### 完了の条件

- 変更後は pnpm test と pnpm run check を通してから、完了報告とコミットを行う
- 新しい処理にはテストを付ける。テストを消したり弱めたりして通さない

### ステップ完了時

「作る順番」の1ステップを終えるたびに、次をやってから完了を報告する。

- 作った・消した・移したファイルを洗い出し、docs/design.md の「ファイル一覧」に反映する
- 依存図（`%% check:deps`）とER図（`%% check:er`）を、実物の import とスキーマに合わせる
- API仕様、環境変数、不変条件、テスト構成の表に変更があれば直す
- `pnpm run check:docs` を通す。通らなければ、設計書か実装のどちらが正しいかを確かめて直す
- 設計書の「最終確認」の日付を更新する。「まだ決まっていないこと」と「今後のステップ」も、進んだ分だけ見直す
- docs/progress.md を更新する（進み具合、決めたこと、ハマったこと）

`check:docs` が見るのは、ファイル・矢印・列の一致まで。図の意味が正しいかは、人が読んで確かめる。

### 計画

- 計画には、処理の流れをテキストの図（5〜8行）で必ず含める
- 初めて出てくる技術用語には、1行の説明を添える

### 設計

- 献立ロジックは src/core/ に置き、外部APIを直接呼ばない
- LINE / Gemini の呼び出しは src/clients/ のみ。テストでは必ずモックする
- Geminiの出力はJSONスキーマで受け、zodで検証してから使う
- 画面はフレームワークなし。素のHTML + JSで書く
- TypeScript strict モード。`any` 型は禁止

### git

- コミットメッセージは日本語で「何を・なぜ」を1〜2行
- コミットしたらPushを行う

### LINE

- Webhookは署名検証を必ず行う
- チャットへの返答は Reply API。Push API は毎朝の提案だけに使う（無料枠が月200通のため）

### セキュリティ

- /api/* は必ずLIFFのトークンをサーバー側で検証し、検証結果のユーザーIDのみ使う
- リクエストボディやクエリのユーザーIDは信用しない
- APIキーとモデルIDは環境変数。コードに直書きしない
- .env / .dev.vars は読まない・コミットしない

### 人間に確認すること

- デプロイ、本番D1へのマイグレーションは人間が実行する
- 依存パッケージの追加、スキーマの変更は先に相談する
- 依存を提案する前に、`npm view <名前> deprecated peerDependencies` で非推奨と対応バージョンを確認する

## 作る順番

1. オウム返しボット（Webhook + 署名検証 + Reply）
2. 在庫API + D1のテーブル
3. LIFFの在庫編集画面 + リッチメニュー
4. チャットでの献立相談（Gemini接続）
5. 毎朝9時のPush

## 失敗ログ（ラチェット）

エージェントがミスをしたら、docs/failure-log.md に1行書き、ルール・テスト・フックのどれかに変換する。
