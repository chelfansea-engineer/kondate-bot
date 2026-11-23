# 設計書

最終確認: 2026-11-23（ステップ2完了時点）

この文書は、実装の現状を表す。計画ではない。未実装のものは「未実装」と明記する。
更新のしかたは [CLAUDE.md](../CLAUDE.md) の「ステップ完了時」に従う。
`pnpm run check:docs` が、ファイル一覧・モジュール依存図・ER図の3つを実物と突き合わせる。

## 1. 全体構成

```mermaid
flowchart LR
  user([ユーザー])

  subgraph LINE["LINE Platform"]
    chat["トーク画面"]
    liff["LIFF 在庫編集画面<br/>（未実装: ステップ3）"]
    msgapi["Messaging API<br/>Reply"]
    verify["IDトークン検証API"]
  end

  subgraph CF["Cloudflare"]
    worker["Worker（Hono）<br/>src/index.ts"]
    d1[("D1<br/>pantry_items")]
  end

  gemini["Gemini API<br/>（未実装: ステップ4）"]
  cron["Cron 9:00 JST<br/>（未実装: ステップ5）"]

  user --> chat
  user --> liff
  chat -->|"POST /webhook<br/>x-line-signature"| worker
  worker -->|"Reply"| msgapi
  liff -->|"/api/pantry<br/>Bearer IDトークン"| worker
  worker -->|"トークン検証"| verify
  worker --> d1
  worker -.-> gemini
  cron -.-> worker
```

## 2. モジュール依存

矢印は「import する側 → import される側」。`src/` の相対 import だけを描く。

層のルール:

- `core/` は何も import しない（純粋な関数と型）
- 外部APIの呼び出しは `clients/` だけ
- `handlers/` が `clients/` と `core/` をつなぐ
- `index.ts` はルート定義だけで、処理は書かない

```mermaid
%% check:deps
flowchart TD
  subgraph entry["入口"]
    index["src/index.ts"]
  end
  subgraph handlers["handlers/"]
    webhook["src/handlers/webhook.ts"]
    auth["src/handlers/auth.ts"]
    hpantry["src/handlers/pantry.ts"]
  end
  subgraph clients["clients/（外部とのやりとり）"]
    line["src/clients/line.ts"]
    d1["src/clients/d1.ts"]
  end
  subgraph core["core/（純粋）"]
    cpantry["src/core/pantry.ts"]
  end
  env["src/env.ts（型）"]

  index --> webhook
  index --> auth
  index --> hpantry
  index --> env
  webhook --> line
  webhook --> env
  auth --> line
  auth --> env
  hpantry --> d1
  hpantry --> cpantry
  hpantry --> env
  d1 --> cpantry
```

## 3. リクエストの流れ

### 3.1 POST /webhook（オウム返し）

```mermaid
sequenceDiagram
  participant L as LINE
  participant W as Worker（webhook.ts）
  participant C as clients/line.ts
  participant R as LINE Reply API

  L->>W: POST /webhook（生ボディ + x-line-signature）
  W->>C: verifySignature(生ボディ, 署名, LINE_CHANNEL_SECRET)
  alt 署名が不正・なし・シークレット未設定
    W-->>L: 401
  else 署名が正しい
    loop テキストメッセージのイベントごと
      W->>C: replyMessage(replyToken, 同じ文面)
      C->>R: POST /v2/bot/message/reply
      Note over W,R: 失敗してもログだけ出して次へ
    end
    W-->>L: 200
  end
```

### 3.2 POST /api/pantry（在庫の追加）

```mermaid
sequenceDiagram
  participant F as LIFF 画面
  participant A as auth.ts（/api/* 全体）
  participant C as clients/line.ts
  participant V as LINE 検証API
  participant H as handlers/pantry.ts
  participant K as core/pantry.ts
  participant D as clients/d1.ts

  F->>A: POST /api/pantry（Authorization: Bearer IDトークン）
  A->>C: verifyIdToken(token, LIFF_CHANNEL_ID)
  C->>V: POST /oauth2/v2.1/verify
  alt トークンなし・不正（検証APIが400）
    A-->>F: 401
  else 検証できた
    V-->>C: sub（ユーザーID）
    A->>H: c.var.userId = sub
    H->>K: parsePantryInput(body)
    alt 入力が不正
      H-->>F: 400
    else
      H->>D: addPantryItem(db, userId, input)
      D-->>H: PantryItem
      H-->>F: 201
    end
  end
```

LINEの障害で検証できなかったときは、`verifyIdToken` が例外を投げ、500になる。

## 4. データモデル

### 4.1 ER図

```mermaid
%% check:er
erDiagram
  pantry_items {
    int id PK "自動採番"
    string user_id "LINEのユーザーID。外部キーではない"
    string name "1〜50文字"
    string category "food または seasoning"
    string memo "既定は空文字。200文字まで"
    string created_at "ISO 8601（UTC）"
  }
```

テーブルは1つだけ。ユーザーの表は持たない。`user_id` は、LIFFのIDトークンを検証して得た `sub` で、Messaging API のWebhookで届く `source.userId` と同じ値（同じプロバイダーの場合）。

### 4.2 制約と設計の理由

| 項目 | 内容 | 理由 |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 画面から `DELETE /api/pantry/:id` で指すだけなので、連番で足りる |
| `category` | `CHECK (category IN ('food', 'seasoning'))` | コードの検証をすり抜けても、DBが不正値を弾く |
| `memo` | `NOT NULL DEFAULT ''` | 「メモなし」を空文字ひとつに揃え、null との二重表現を避ける |
| `created_at` | `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` | UTCのISO形式の文字列。並べ替えと表示がそのままできる |
| インデックス | `idx_pantry_items_user_id (user_id)` | 一覧・削除はすべて `user_id` で絞る |
| 持たないもの | 数量、賞味期限 | CLAUDE.md の方針。必要になったら相談してから足す |

### 4.3 アクセスの規則

- 読み書きはすべて `clients/d1.ts` を通し、**必ず `user_id` で絞る**
- 他人の在庫は、一覧に出ず、削除もできない
- 削除対象が存在しない場合と、他人の在庫の場合は区別せず、どちらも404

### 4.4 まだ決まっていないこと（実装していない）

どれもスキーマ変更になるので、該当ステップの前に相談する。

| 論点 | 状況 |
| --- | --- |
| 配信対象のユーザー一覧（ステップ5） | `pantry_items` の `DISTINCT user_id` で代用できる。ただしブロックしたユーザーにもPushして、月200通の無料枠を消費する恐れがある。`users` テーブル（user_id、友だち追加日時、ブロック日時など）を作る案がある |
| 同名の在庫の重複 | いまは許す。`UNIQUE (user_id, name)` にするかは未決 |
| Geminiへ渡す在庫の形 | ステップ4で決める。`name` と `category` だけで足りる見込み |

## 5. API仕様

認証がある経路では、検証したユーザーIDだけを使う。ボディとクエリのユーザーIDは読まない。

| メソッド | パス | 認証 | 入力 | 成功 | 失敗 |
| --- | --- | --- | --- | --- | --- |
| POST | `/webhook` | `x-line-signature` | LINEのWebhookボディ | 200 | 401 署名不正 |
| GET | `/api/pantry` | `Authorization: Bearer <IDトークン>` | なし | 200 `{ items: PantryItem[] }` | 401 |
| POST | `/api/pantry` | 同上 | `{ name, category, memo? }` | 201 `{ item: PantryItem }` | 400 入力不正、401 |
| DELETE | `/api/pantry/:id` | 同上 | `:id` は正の整数 | 204 | 400 IDが不正、404 見つからない（他人の分を含む）、401 |

- `/api/*` 配下はどのパスでも、認証ミドルウェアを先に通る。存在しないパスも、トークンなしなら401
- 認証できなかったとき（LINEの障害など）は500
- `PantryItem` は `{ id: number, name: string, category: "food" | "seasoning", memo: string, createdAt: string }`

## 6. 環境変数とバインディング

| 名前 | 種類 | 用途 |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | 秘密 | Webhookの署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 秘密 | Reply API の認証 |
| `LIFF_CHANNEL_ID` | 設定値 | IDトークンの検証で、audience として使う（LIFFを載せたLINEログインチャネルのID）。秘密ではないので `wrangler.jsonc` の `vars` に置く |
| `DB` | D1バインディング | `kondate-bot`（本番D1は作成済み。`wrangler.jsonc` の `database_id` に本番のIDを入れている）。バインディング名は必ず `DB` |

秘密の2つは、ローカルでは `.dev.vars`（コミットしない）、本番では `wrangler secret put` で置く。見本は `.dev.vars.example`。未実装の `GEMINI_MODEL` などは、使うステップで足す。

## 7. 外部サービスの呼び出し

| 呼び出し | 場所 | 使うタイミング |
| --- | --- | --- |
| LINE Reply API | `clients/line.ts` の `replyMessage` | チャットへの返答 |
| LINE IDトークン検証API | `clients/line.ts` の `verifyIdToken` | `/api/*` の認証 |

どちらも `clients/` の中だけ。テストでは必ずモックする。Push API は、ステップ5の毎朝の提案だけに使う予定（未実装）。

## 8. テスト構成

| ファイル | 対象 | 方針 |
| --- | --- | --- |
| `test/core-pantry.test.ts` | 入力検証 | 純粋関数。境界値を確かめる |
| `test/d1.test.ts` | D1ラッパー | 本物のローカルD1。ユーザーで絞れていることを確かめる |
| `test/line.test.ts` | 署名検証、Reply、IDトークン検証 | `fetch` をスタブする |
| `test/webhook.test.ts` | `/webhook` 全体 | `replyMessage` をモック。署名検証は本物 |
| `test/pantry-api.test.ts` | `/api/pantry` 全体 | `verifyIdToken` をモック、D1は本物。ボディやクエリのユーザーIDを信用しないことを確かめる |

共通の決まり:

- DBを使うテストは、`beforeEach` で `resetDb()` を呼ぶ（スキーマ適用と全削除）
- `blockNetwork()` で、テスト中の外部通信を失敗させる。モックが効かなくなっても、本物のLINEを叩かない
- `setupFiles` は使わない。`cloudflare:test` を先に読み込むと、Worker本体が本物の clients をキャッシュし、`vi.mock` が効かなくなる

## 9. 守っている不変条件

| 不変条件 | 守っている場所 |
| --- | --- |
| Webhookは署名検証を必ず行う | `handlers/webhook.ts`（JSONを読む前に検証） |
| `/api/*` はトークン検証を必ず通る | `index.ts` の `app.use("/api/*", ...)` |
| ユーザーIDは検証結果だけを使う | `handlers/pantry.ts` は `c.var.userId` のみを読む |
| 他人の在庫に触れない | `clients/d1.ts` の全クエリが `user_id` で絞る |
| 外部APIは `clients/` だけが呼ぶ | 層のルール（第2章）。`core/` は何も import しない |
| チャットへの返答は Reply API | `webhook.ts` は `replyMessage` のみ。Push API は未使用 |

## 10. ファイル一覧

`src/`、`test/`、`scripts/`、`migrations/` の全ファイルを載せる。`pnpm run check:docs` が、ここと実物の差を見つける。

| ファイル | 役割 | 追加したステップ |
| --- | --- | --- |
| `src/index.ts` | Honoのルート定義。認証ミドルウェアの適用 | 1 |
| `src/env.ts` | 環境変数とバインディングの型、リクエスト単位の変数の型 | 1 |
| `src/handlers/webhook.ts` | 署名検証とオウム返し | 1 |
| `src/handlers/auth.ts` | `/api/*` のトークン検証ミドルウェア | 2 |
| `src/handlers/pantry.ts` | 在庫API（GET / POST / DELETE） | 2 |
| `src/clients/line.ts` | 署名検証、Reply API、IDトークン検証 | 1 |
| `src/clients/d1.ts` | 在庫のD1操作（一覧・追加・削除） | 2 |
| `src/core/pantry.ts` | 在庫の型、カテゴリ、入力検証 | 2 |
| `migrations/0001_create_pantry_items.sql` | `pantry_items` の作成 | 2 |
| `scripts/simulate.ts` | 擬似Webhookを送る | 2 |
| `scripts/check-docs.ts` | この設計書と実物の突き合わせ | 2 |
| `scripts/node-shims.d.ts` | `@types/node` を入れていないための、最小の型宣言 | 2 |
| `test/helpers.ts` | 署名の生成、DB初期化、外部通信ガード | 1 |
| `test/env.d.ts` | テスト用バインディングの型 | 2 |
| `test/line.test.ts` | LINEクライアントのテスト | 1 |
| `test/webhook.test.ts` | Webhookのテスト | 1 |
| `test/core-pantry.test.ts` | 入力検証のテスト | 2 |
| `test/d1.test.ts` | D1ラッパーのテスト | 2 |
| `test/pantry-api.test.ts` | 在庫APIのテスト | 2 |

設定ファイル（一覧の突き合わせの対象外）: `package.json`、`wrangler.jsonc`、`tsconfig.json`、`vitest.config.ts`、`biome.json`、`.gitignore`、`.dev.vars.example`。

## 11. 今後のステップで増えるもの（未実装）

| ステップ | 増えるもの |
| --- | --- |
| 3 | `public/liff/`（素のHTML + JS）、`GET /liff/*` の配信、リッチメニュー |
| 4 | Gemini クライアント（`clients/`）、献立の提案ロジック（`core/`）、zod による出力検証 |
| 5 | `scheduled`（cron 9:00 JST）、Push API の呼び出し |
