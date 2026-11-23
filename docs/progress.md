# 進み具合

最終更新: 2026-11-23

## いまどこ

- ステップ1（オウム返しボット）… 完了。実際のLINEで確認済み
- ステップ2（在庫API + D1のテーブル + `pnpm run simulate`）… 実装済み。ローカルのブランチ `feature/step2-pantry-api` にコミット済みで、未プッシュ
- 次はステップ3（LIFFの在庫編集画面 + リッチメニュー）。その前に、下の「人間がやること」を済ませる

| ステップ | 内容 | 状態 |
| --- | --- | --- |
| 1 | オウム返しボット（Webhook + 署名検証 + Reply） | 完了 |
| 2 | 在庫API + D1のテーブル | 実装済み（未プッシュ。本番D1は未作成） |
| 3 | LIFFの在庫編集画面 + リッチメニュー | 未着手 |
| 4 | チャットでの献立相談（Gemini接続） | 未着手 |
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

## 決めたこと

- トークンはIDトークン（`liff.getIDToken()`）を `Authorization: Bearer` で送る。アクセストークンだと検証とプロフィール取得で2回LINEを呼ぶため
- 認証は `app.use("/api/*", ...)` で全体にかける。今後 `/api/*` にルートを足しても、検証を通らずには届かない
- 検証できなかった（LINEの障害など）ときは401にせず例外（500）にする。400だけを「不正なトークン」として扱う
- zod はまだ入れず、入力検証は手書き（`parsePantryInput`）。入れるのは依存追加なので相談してから。ステップ4で入れるなら置き換える
- 新しい環境変数は `LIFF_CHANNEL_ID`（LIFFを載せたLINEログインチャネルのID）。`.dev.vars.example` に追記済み
- 在庫IDは整数の自動採番。画面で重複する名前も許す

## ハマったこと

- **setupFiles が vi.mock を無効にする**: セットアップで `cloudflare:test` を読み込むとWorker本体が本物のclientsごとキャッシュされ、テストのモックが効かず、本物のLINE APIを叩いた。`resetDb()` をテストから呼ぶ形にし、`blockNetwork()` で外部通信を失敗させるようにした
- **GETにボディ**: テストで `Request` にGETのボディを付けると例外になる
- **D1のマイグレーションをテストで適用する**: `readD1Migrations` を `vitest.config.ts` で読み、`TEST_MIGRATIONS` として渡して `applyD1Migrations` で適用する。`exec` に複数行のSQLを渡す方法は使えない
- **ステップ1の積み残し**: ステップ1のブランチはまだ `main` にマージされていない。ステップ2のブランチはその先頭から切っている

## 人間がやること

- 本番D1を作る: `wrangler d1 create kondate-bot`。出力された `database_id` を `wrangler.jsonc` の仮の値（`00000000-...`）と差し替える
- 本番にマイグレーションを適用する: `wrangler d1 migrations apply kondate-bot --remote`
- LINEログインチャネルを作り、LIFFアプリを登録する（スコープに `openid` が必要）。このチャネルは、Messaging API のチャネルと同じプロバイダーにする。別のプロバイダーだとユーザーIDが一致しない
- `.dev.vars` に `LIFF_CHANNEL_ID`（LINEログインチャネルのチャネルID）を追記する。本番は `wrangler secret put LIFF_CHANNEL_ID`
- 常時動かすにはデプロイが必要（`wrangler deploy` と、`wrangler secret put` で3つの値を登録）
- ステップ1とステップ2のブランチのプッシュ、PR作成、マージ
- `pnpm install` 時のビルドスクリプト警告（esbuild / workerd）を消すなら `pnpm approve-builds`
