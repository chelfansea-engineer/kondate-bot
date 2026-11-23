# 進み具合

最終更新: 2026-11-23（設計書を追加）

## いまどこ

- ステップ1（オウム返しボット）… 完了。実際のLINEで確認済み
- ステップ2（在庫API + D1のテーブル + `pnpm run simulate`）… 完了。`main` にマージしてプッシュ済み。本番D1も作成・マイグレーション済み
- 次はステップ3（LIFFの在庫編集画面 + リッチメニュー）。その前に、下の「人間がやること」を済ませる

| ステップ | 内容 | 状態 |
| --- | --- | --- |
| 1 | オウム返しボット（Webhook + 署名検証 + Reply） | 完了 |
| 2 | 在庫API + D1のテーブル | 完了（`main` にマージ・プッシュ済み。本番D1の作成とマイグレーションも済） |
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
- `docs/design.md`: 現状の設計書（構成図、モジュール依存図、シーケンス図、ER図、API仕様、ファイル一覧）
- `scripts/check-docs.ts`（`pnpm run check:docs`）: 設計書のファイル一覧・依存図・ER図を実物と突き合わせる。ステップ完了時のルールは CLAUDE.md に書いた

## 決めたこと

- トークンはIDトークン（`liff.getIDToken()`）を `Authorization: Bearer` で送る。アクセストークンだと検証とプロフィール取得で2回LINEを呼ぶため
- 認証は `app.use("/api/*", ...)` で全体にかける。今後 `/api/*` にルートを足しても、検証を通らずには届かない
- 検証できなかった（LINEの障害など）ときは401にせず例外（500）にする。400だけを「不正なトークン」として扱う
- zod はまだ入れず、入力検証は手書き（`parsePantryInput`）。入れるのは依存追加なので相談してから。ステップ4で入れるなら置き換える
- 新しい環境変数は `LIFF_CHANNEL_ID`（LIFFを載せたLINEログインチャネルのID）。`.dev.vars.example` に追記済み
- 在庫IDは整数の自動採番。画面で重複する名前も許す

- 設計書の更新は、ステップ完了時に行う（CLAUDE.md「ステップ完了時」）。`check:docs` は `pnpm run check` には含めていない。作業の途中で落ちるのを避けるため
- `@types/node` は入れず、`scripts/node-shims.d.ts` に使う分だけの型宣言を置いた。入れるなら依存追加なので相談してから

## ハマったこと

- **setupFiles が vi.mock を無効にする**: セットアップで `cloudflare:test` を読み込むとWorker本体が本物のclientsごとキャッシュされ、テストのモックが効かず、本物のLINE APIを叩いた。`resetDb()` をテストから呼ぶ形にし、`blockNetwork()` で外部通信を失敗させるようにした
- **GETにボディ**: テストで `Request` にGETのボディを付けると例外になる
- **D1のマイグレーションをテストで適用する**: `readD1Migrations` を `vitest.config.ts` で読み、`TEST_MIGRATIONS` として渡して `applyD1Migrations` で適用する。`exec` に複数行のSQLを渡す方法は使えない
- **ステップ1の積み残し**: ステップ1のブランチはまだ `main` にマージされていない。ステップ2のブランチはその先頭から切っている

## 人間がやること

- 本番D1を作る: 済（2026-11-23）。`database_id` は `wrangler.jsonc` に反映済み。`wrangler d1 create` の「設定を自動追加しますか？」には `n` と答える（バインディング名が `kondate_bot` になり、コードの `env.DB` と合わなくなるため）
- 本番にマイグレーションを適用する: 済（2026-11-23。`0001_create_pantry_items.sql` を適用）
- LINEログインチャネルを作った（済）。LIFFアプリの登録は、エンドポイントURL（デプロイ後のドメイン）が決まってから。LIFFアプリを登録する（スコープに `openid` が必要）。このチャネルは、Messaging API のチャネルと同じプロバイダーにする。別のプロバイダーだとユーザーIDが一致しない
- `LIFF_CHANNEL_ID`: 済。秘密ではないので `wrangler.jsonc` の `vars` に入れた（2026-11-23、LINEログインチャネルのチャネルID）。`.dev.vars` に空で書くと上書きされるので書かない
- デプロイ: 済（2026-11-23。`https://kondate-bot.<サブドメイン>.workers.dev`）。初回は、アップロード直後の確認で `10007 This Worker does not exist` と出て失敗したが、同じコマンドの再実行で通った（反映待ちと見ている）
- 本番に秘密を登録する: `wrangler secret put LINE_CHANNEL_SECRET` と `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN`（未了）
- LINEの Webhook URL を `https://<ドメイン>/webhook` に付け替え、「検証」を通す（未了。トンネルは不要になる）
- 設定を変えたら再デプロイが要る（`wrangler.jsonc` の `workers_dev` / `preview_urls` の明示は次回のデプロイで反映）
- ステップ1とステップ2のブランチのプッシュ、PR作成、マージ
- `pnpm install` 時のビルドスクリプト警告（esbuild / workerd）を消すなら `pnpm approve-builds`
