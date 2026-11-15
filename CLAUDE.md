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
| GET/POST/DELETE /api/pantry               | 画面から呼ぶ在庫API                 |
| scheduled（cron: `0 0 * * *` = 9:00 JST） | 毎朝の献立Push                      |

## ディレクトリ

- src/index.ts … Honoのルート定義と scheduled。処理は書かない
- src/env.ts … 環境変数（Env）の型
- src/handlers/ … 各入口の処理（いまは webhook.ts のみ）
- src/clients/ … LINE / Gemini / D1 の薄いラッパー（いまは line.ts のみ）
- test/ … テスト。helpers.ts に署名生成などの共通処理
- docs/progress.md … 進み具合、決めたこと、ハマったこと
- .dev.vars.example … 環境変数の見本（本物の .dev.vars は各自で作る）

まだ無いもの（該当ステップで作る）:

- src/core/ … 献立ロジック（純粋な関数。外部APIを呼ばない）
- public/liff/ … 在庫編集画面
- migrations/ … D1のスキーマ

## データ

在庫（pantry_items）: id / user_id / name / category（food | seasoning）/ memo / created_at
数量と賞味期限は持たない。必要になったら相談してから足す。

## コマンド

- pnpm test … 単体テスト
- pnpm run check … 型チェック + lint
- pnpm run dev … ローカル起動
- pnpm run simulate … 擬似Webhookを送って動作確認（未実装。ステップ2で作る）

## ルール

### 進め方

- 必ずブランチを作成して開発すること
- 動作確認で起動したプロセス（dev サーバーなど）は必ず止め、ポートが空いたことを確認してから報告する

### 完了の条件

- 変更後は pnpm test と pnpm run check を通してから完了報告する
- 新しい処理にはテストを付ける。テストを消したり弱めたりして通さない

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
- コミットは、pnpm test と pnpm check が通った状態でのみ行う
- コミットメッセージは日本語で「何を・なぜ」を1〜2行
- そのあとPushを行う
- デプロイは人間が行う

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

1. オウム返しボット（Webhook + 署名検証 + Reply）… 完了（2026-11-15）
2. 在庫API + D1のテーブル
3. LIFFの在庫編集画面 + リッチメニュー
4. チャットでの献立相談（Gemini接続）
5. 毎朝9時のPush

## 失敗ログ（ラチェット）

エージェントがミスをしたら、ここに1行書き、ルール・テスト・フックのどれかに変換する。

| 日付 | 起きたこと | 対策 |
| ---- | ---------- | ---- |
| 2026-11-15 | 承認リストにない `@cloudflare/workers-types` を相談なしで追加した（型定義用） | ルール「依存パッケージの追加は先に相談」を再確認。承認済みリストと `pnpm add` の引数を突き合わせてから実行する |
| 2026-11-15 | 提案したテスト用パッケージ `@cloudflare/vitest-pool-workers` が非推奨（改名済み）だった。入れてから気づき、vitest の固定と互換日付の引き下げ、のちに入れ替えという手戻りになった | ルール化:「依存を提案する前に非推奨と対応バージョンを確認する」 |
| 2026-11-15 | 動作確認で起動した dev サーバーを止め損ね、ポート8787を占有したままにした。ユーザーの dev が8788で起動した | ルール化:「起動したプロセスは必ず止め、ポートが空いたことを確認する」 |
| 2026-11-15 | Biome の自動整形が CLAUDE.md と README.md まで書き換え、手で編集すると check が落ちる状態になった | 設定化: biome.json で Markdown を対象外にした |
| 2026-11-15 | シークレット未設定のとき /webhook が500になった。テストでは気づけず、dev で試して見つけた | テスト化: 未設定なら署名検証が false になるテストを追加（test/line.test.ts） |
| 2026-11-15 | CLAUDE.md のコマンド表記（npm）とパッケージ管理（pnpm）がずれたまま計画を出した | pnpm に統一済み。計画時に CLAUDE.md と実物のずれを見つけたら、その場で指摘する |
