# 設計書

最終確認: 2026-11-24（ステップ5の完了時点。食べたものの記録は、本番でLINE上の動作確認済み）

この文書は、実装の現状を表す。計画ではない。未実装のものは「未実装」と明記する。
更新のしかたは [CLAUDE.md](../CLAUDE.md) の「ステップ完了時」に従う。
`pnpm run check:docs` が、ファイル一覧・モジュール依存図・ER図の3つを実物と突き合わせる。

## 1. 全体構成

```mermaid
flowchart LR
  user([ユーザー])

  subgraph LINE["LINE Platform"]
    chat["トーク画面"]
    liff["LIFF 在庫編集画面<br/>public/liff/"]
    msgapi["Messaging API<br/>Reply"]
    verify["IDトークン検証API"]
  end

  subgraph CF["Cloudflare"]
    worker["Worker（Hono）<br/>src/index.ts"]
    d1[("D1<br/>pantry_items・meals")]
  end

  gemini["Gemini API"]
  cron["Cron 9:00 JST<br/>（未実装: ステップ6）"]

  user --> chat
  user --> liff
  chat -->|"POST /webhook<br/>x-line-signature"| worker
  worker -->|"Reply"| msgapi
  liff -->|"/liff/* の取得<br/>/api/pantry・/api/meals（Bearer IDトークン）"| worker
  worker -->|"トークン検証"| verify
  worker --> d1
  worker -->|"献立の提案"| gemini
  cron -.-> worker
```

## 2. モジュール依存

矢印は「import する側 → import される側」。`src/` の相対 import だけを描く（外部パッケージの `hono` と `zod` は描かない）。

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
    hsuggest["src/handlers/suggest.ts"]
    hmeals["src/handlers/meals.ts"]
  end
  subgraph clients["clients/（外部とのやりとり）"]
    line["src/clients/line.ts"]
    d1["src/clients/d1.ts"]
    gemini["src/clients/gemini.ts"]
  end
  subgraph core["core/（純粋）"]
    cpantry["src/core/pantry.ts"]
    cmeals["src/core/meals.ts"]
    csuggest["src/core/suggest.ts"]
    cid["src/core/id.ts"]
  end
  env["src/env.ts（型）"]

  index --> webhook
  index --> auth
  index --> hpantry
  index --> hmeals
  index --> env
  webhook --> line
  webhook --> hsuggest
  webhook --> env
  hsuggest --> d1
  hsuggest --> gemini
  hsuggest --> line
  hsuggest --> csuggest
  hsuggest --> cmeals
  hsuggest --> env
  auth --> line
  auth --> env
  hpantry --> d1
  hpantry --> cpantry
  hpantry --> cid
  hpantry --> env
  hmeals --> d1
  hmeals --> cmeals
  hmeals --> cid
  hmeals --> env
  d1 --> cpantry
  d1 --> cmeals
  csuggest --> cpantry
  csuggest --> cmeals
```

## 3. リクエストの流れ

### 3.1 POST /webhook（献立の提案）

```mermaid
sequenceDiagram
  participant L as LINE
  participant W as Worker（webhook.ts）
  participant C as clients/line.ts
  participant S as handlers/suggest.ts
  participant D as clients/d1.ts
  participant G as clients/gemini.ts
  participant K as core/suggest.ts
  participant R as LINE Reply API

  L->>W: POST /webhook（生ボディ + x-line-signature）
  W->>C: verifySignature(生ボディ, 署名, LINE_CHANNEL_SECRET)
  alt 署名が不正・なし・シークレット未設定
    W-->>L: 401
  else 署名が正しい
    W-->>L: 200（先に返す）
    loop 1対1のテキストメッセージごと（応答のあと。waitUntil）
      W->>S: replyWithSuggestion(送信者のID, replyToken, 本文)
      S->>D: listPantryItems(db, 送信者のID)
      S->>D: listMeals(db, 送信者のID, 直近7日)
      alt 在庫が空
        S->>R: Reply（登録をうながす。Geminiは呼ばない）
      else 在庫がある
        S->>K: buildPrompt(本文, 在庫, 直近の食事, 今日)
        S->>G: generateJson(プロンプト, JSONスキーマ)
        alt 失敗、または出力が想定の形でない
          S->>R: Reply（お詫び）
        else 検証に通った
          S->>K: parseSuggestion → formatReply
          S->>R: Reply（3品以内の提案）
        end
      end
    end
  end
```

- 提案には、在庫に加えて、直近7日の食事（新しい順）を渡す。同じ料理や似た料理が続かず、栄養が偏らないように、Geminiに指示する
- 扱うのは、1対1のトークのテキストだけ。グループ・ルームの発言、スタンプなどは無視する
- ユーザーIDは、署名検証を通ったイベントの `source.userId`。本文には含まれない
- Geminiは数秒かかるので、LINEには先に200を返し、残りは応答のあとで行う。イベントごとに独立していて、1件の失敗が他を止めない
- Geminiの出力は、zod（`zod/mini`）で検証してから使う。通らなければ、そのまま送らずにお詫びを返す
- 失敗はログに出す（`wrangler tail` で見られる）。ユーザーには定型のお詫びだけを返す

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

### 3.3 LIFF画面（在庫・食べたものの表示・追加・削除）

画面は `public/liff/` の静的ファイル。Workerのコードは通らず、Cloudflareの静的アセット機能が直接返す。

```mermaid
sequenceDiagram
  participant U as ユーザー（LINEアプリ）
  participant S as LIFF SDK（static.line-scdn.net）
  participant P as 画面（app.js）
  participant W as Worker（/api/pantry、/api/meals）

  U->>P: リッチメニューから開く（/liff/?tab=pantry または ?tab=meals）
  P->>S: liff.init(LIFF ID)
  S-->>P: ログイン済み（IDトークンを持つ）
  P->>P: IDトークンの期限を確認（近ければ再ログイン）
  P->>W: 開いたタブのAPIを GET（Bearer IDトークン）
  W-->>P: 在庫なら { items }、食事なら { today, meals }
  P->>P: 表示（在庫は区分ごと、食事は日付ごと。textContent のみ）
  U->>P: 追加 / 削除（削除は2回押し）
  P->>W: POST / DELETE（Bearer IDトークン）
  W-->>P: 201 / 204
  P->>P: 一覧を更新（食事は取り直す）
  U->>P: 別のタブを選ぶ（初めてなら、そのタブのAPIを GET）
```

- ユーザーIDは画面からは送らない。送るのはIDトークンだけで、サーバーが検証して取り出す
- 「今日」は、サーバーが日本時間で決める。`GET /api/meals` の応答の `today` を、画面が日付の初期値・上限・「今日」「昨日」の表示に使う
- パネル（フォームと一覧）は、読み込みが終わるまで隠す。イベントを付ける前に、送信されないようにするため
- IDトークンの期限は約1時間。期限が近いと `liff.logout()` と `liff.login()` でログインし直す。それでも取れないときは、繰り返さずエラーを出す（LIFFの Scope に `openid` が無い場合）

### 3.4 リッチメニュー（コードの外）

トーク画面下のメニューは、LINE Official Account Manager の画面で設定する（このリポジトリには入らない）。2分割のテンプレートで、左が「在庫」（`https://liff.line.me/<LIFF ID>?tab=pantry`）、右が「食べたもの」（`https://liff.line.me/<LIFF ID>?tab=meals`）。LIFFのURLに付けたクエリは、初期化のあとに画面の `location` へ反映される。

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
  meals {
    int id PK "自動採番"
    string user_id "LINEのユーザーID。外部キーではない"
    string eaten_on "食べた日。日本時間のYYYY-MM-DD"
    string name "1〜50文字"
    string created_at "ISO 8601（UTC）"
  }
```

テーブルは2つ（`pantry_items` と `meals`）。ユーザーの表は持たない。`user_id` は、LIFFのIDトークンを検証して得た `sub` で、Messaging API のWebhookで届く `source.userId` と同じ値（同じプロバイダーの場合）。

### 4.2 制約と設計の理由

| 項目 | 内容 | 理由 |
| --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 画面から `DELETE /api/pantry/:id` で指すだけなので、連番で足りる |
| `category` | `CHECK (category IN ('food', 'seasoning'))` | コードの検証をすり抜けても、DBが不正値を弾く |
| `memo` | `NOT NULL DEFAULT ''` | 「メモなし」を空文字ひとつに揃え、null との二重表現を避ける |
| `created_at` | `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` | UTCのISO形式の文字列。並べ替えと表示がそのままできる |
| インデックス | `idx_pantry_items_user_id (user_id)` | 一覧・削除はすべて `user_id` で絞る |
| 持たないもの | 数量、賞味期限 | CLAUDE.md の方針。必要になったら相談してから足す |

`meals` の制約:

| 項目 | 内容 | 理由 |
| --- | --- | --- |
| `eaten_on` | `TEXT`（`YYYY-MM-DD`、日本時間の日付） | 日付だけで足りる。文字列のまま、日付の前後を比べられる |
| `created_at` | `pantry_items` と同じ | 同上 |
| インデックス | `idx_meals_user_id_eaten_on (user_id, eaten_on)` | 「自分の、直近7日」で絞って読む |
| 持たないもの | 朝・昼・晩の区別、メモ | 提案に使うのは「最近、何を食べたか」だけで、いまは足りる。必要になったら相談してから足す |

### 4.3 アクセスの規則

- 読み書きはすべて `clients/d1.ts` を通し、**必ず `user_id` で絞る**
- 他人の在庫は、一覧に出ず、削除もできない
- 削除対象が存在しない場合と、他人の在庫の場合は区別せず、どちらも404
- 食事（`meals`）も同じ。読み書きはすべて `user_id` で絞り、他人の食事は一覧にも削除にも出ない
- 食事の日付は、日本時間の `YYYY-MM-DD`。今日より先の日付と、60日より前の日付は、受け付けない

### 4.4 まだ決まっていないこと（実装していない）

どれもスキーマ変更になるので、該当ステップの前に相談する。

| 論点 | 状況 |
| --- | --- |
| 配信対象のユーザー一覧（ステップ6） | `pantry_items` の `DISTINCT user_id`（在庫のある人）に送る方針。利用者がほぼ1人のため、費用や無料枠（月200通）は気にしない。ブロックした人にも送る恐れはあるが、いまは許容する。`users` テーブルを作る案は、必要になったら相談する |
| 食事の朝・昼・晩の区別 | 持たない。区別したくなったら、列を足す（相談する） |
| 同じ日・同じ名前の食事 | いまは重複を許す |
| 同名の在庫の重複 | いまは許す。`UNIQUE (user_id, name)` にするかは未決 |
| 利用回数の制限 | いまは無い。友だち追加した誰でもGeminiを呼べる。必要なら、1人あたりの回数をD1に持つ（表が増える） |

## 5. API仕様

認証がある経路では、検証したユーザーIDだけを使う。ボディとクエリのユーザーIDは読まない。

| メソッド | パス | 認証 | 入力 | 成功 | 失敗 |
| --- | --- | --- | --- | --- | --- |
| GET | `/liff/*` | なし | なし | 200 静的ファイル（`/liff` は307で `/liff/` へ） | 404 |
| POST | `/webhook` | `x-line-signature` | LINEのWebhookボディ | 200 | 401 署名不正 |
| GET | `/api/pantry` | `Authorization: Bearer <IDトークン>` | なし | 200 `{ items: PantryItem[] }` | 401 |
| POST | `/api/pantry` | 同上 | `{ name, category, memo? }` | 201 `{ item: PantryItem }` | 400 入力不正、401 |
| DELETE | `/api/pantry/:id` | 同上 | `:id` は正の整数 | 204 | 400 IDが不正、404 見つからない（他人の分を含む）、401 |
| GET | `/api/meals` | 同上 | なし | 200 `{ today: string, meals: Meal[] }`（直近7日、新しい順） | 401 |
| POST | `/api/meals` | 同上 | `{ name, eatenOn? }`（`eatenOn` を省くと今日） | 201 `{ meal: Meal }` | 400 入力不正（今日より先、60日より前を含む）、401 |
| DELETE | `/api/meals/:id` | 同上 | `:id` は正の整数 | 204 | 400 IDが不正、404 見つからない（他人の分を含む）、401 |

- `/api/*` 配下はどのパスでも、認証ミドルウェアを先に通る。存在しないパスも、トークンなしなら401
- 認証できなかったとき（LINEの障害など）は500
- `PantryItem` は `{ id: number, name: string, category: "food" | "seasoning", memo: string, createdAt: string }`
- `Meal` は `{ id: number, name: string, eatenOn: string, createdAt: string }`。`eatenOn` は日本時間の `YYYY-MM-DD`

## 6. 環境変数とバインディング

| 名前 | 種類 | 用途 |
| --- | --- | --- |
| `LINE_CHANNEL_SECRET` | 秘密 | Webhookの署名検証 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 秘密 | Reply API の認証 |
| `GEMINI_API_KEY` | 秘密 | Gemini APIの認証（ヘッダ `x-goog-api-key` で送る） |
| `GEMINI_MODEL` | 設定値 | 使うモデルID（いまは `gemini-3.8-flash`）。コードには書かず、`wrangler.jsonc` の `vars` に置く。変えたら再デプロイ |
| `LIFF_CHANNEL_ID` | 設定値 | IDトークンの検証で、audience として使う（LIFFを載せたLINEログインチャネルのID）。秘密ではないので `wrangler.jsonc` の `vars` に置く |
| LIFF ID（環境変数ではない） | 公開される値 | `public/liff/index.html` の `<meta name="liff-id">` に置く（LIFFのURLに含まれる値。認証情報ではない） |
| `DB` | D1バインディング | `kondate-bot`（本番D1は作成済み。`wrangler.jsonc` の `database_id` に本番のIDを入れている）。バインディング名は必ず `DB` |

秘密の3つ（`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`GEMINI_API_KEY`）は、ローカルでは `.dev.vars`（コミットしない）、本番では `wrangler secret put` で置く。見本は `.dev.vars.example`。

## 7. 外部サービスの呼び出し

| 呼び出し | 場所 | 使うタイミング |
| --- | --- | --- |
| LINE Reply API | `clients/line.ts` の `replyMessage` | チャットへの返答 |
| LINE IDトークン検証API | `clients/line.ts` の `verifyIdToken` | `/api/*` の認証 |
| Gemini API（`generateContent`） | `clients/gemini.ts` の `generateJson` | 献立の提案。JSONスキーマを指定して、JSONで受ける |

すべて `clients/` の中だけ。テストでは必ずモックする。Push API は、ステップ6の毎朝の提案だけに使う予定（未実装）。

## 8. テスト構成

| ファイル | 対象 | 方針 |
| --- | --- | --- |
| `test/core-pantry.test.ts` | 入力検証 | 純粋関数。境界値を確かめる |
| `test/core-meals.test.ts` | 食事の入力検証、日本時間の日付、日付の計算、パスのID | 純粋関数。月・年・うるう年の境目、今日より先と60日前の境目を確かめる |
| `test/d1.test.ts` | D1ラッパー（在庫・食事） | 本物のローカルD1。ユーザーで絞れていること、直近の絞り込み、並び順を確かめる |
| `test/line.test.ts` | 署名検証、Reply、IDトークン検証 | `fetch` をスタブする |
| `test/core-suggest.test.ts` | 出力スキーマ、プロンプト、返信の整形 | 純粋関数。形が違う出力を弾くこと、利用者の文字から区切りを除くことを確かめる |
| `test/gemini.test.ts` | Geminiクライアント | `fetch` をスタブする。リクエストの形、キーがURLに入らないこと、使えない応答を例外にすることを確かめる |
| `test/webhook.test.ts` | `/webhook` 全体（提案の流れ） | `replyMessage` と `generateJson` をモック。署名検証とD1は本物。「先に200を返す」「他人の在庫を使わない」「在庫が空ならGeminiを呼ばない」などを確かめる |
| `test/meals-api.test.ts` | `/api/meals` 全体 | `verifyIdToken` をモック、D1は本物、`Date` は固定（日本時間 2026-11-24 の朝9時30分）。直近7日の境目、ボディやクエリのユーザーIDを信用しないことを確かめる |
| `test/pantry-api.test.ts` | `/api/pantry` 全体 | `verifyIdToken` をモック、D1は本物。ボディやクエリのユーザーIDを信用しないことを確かめる |
| `test/liff-view.test.ts` | 画面の表示ロジック（`pantry-view.js`、`meals-view.js`） | 純粋関数。区分ごとの分け方、日付の表示（今日・昨日・曜日）、同じ日のまとめ方を確かめる |
| `test/liff-screen.test.ts` | 画面ファイルの中身 | `?raw` で読んだ文字列を検査する（タブとパネルの有無、パネルは隠してあること、LIFF IDの形式、入力上限がAPIと同じ、全JSがHTML差し込みAPIを使わない・ユーザーIDを扱わない、APIの呼び出しは `callApi` を通す） |

共通の決まり:

- DBを使うテストは、`beforeEach` で `resetDb()` を呼ぶ（スキーマ適用と全削除）
- `blockNetwork()` で、テスト中の外部通信を失敗させる。モックが効かなくなっても、本物のLINEを叩かない
- 静的アセットの配信はテストできない（テスト環境の `SELF` は静的アセットを返さない）。`wrangler dev` で確かめる
- 画面の動作（表示・追加・削除）は、LIFFと `fetch` をモックしたページをヘッドレスChromeで動かして確かめた（リポジトリには入れていない）
- `setupFiles` は使わない。`cloudflare:test` を先に読み込むと、Worker本体が本物の clients をキャッシュし、`vi.mock` が効かなくなる

## 9. 守っている不変条件

| 不変条件 | 守っている場所 |
| --- | --- |
| Webhookは署名検証を必ず行う | `handlers/webhook.ts`（JSONを読む前に検証） |
| `/api/*` はトークン検証を必ず通る | `index.ts` の `app.use("/api/*", ...)` |
| ユーザーIDは検証結果だけを使う | `handlers/pantry.ts` は `c.var.userId` のみを読む |
| 他人の在庫に触れない | `clients/d1.ts` の全クエリが `user_id` で絞る |
| 外部APIは `clients/` だけが呼ぶ | 層のルール（第2章）。`core/` は何も import しない |
| 画面は、利用者が入れた文字をそのまま文字として出す | `public/liff/` の全JSは `textContent` だけを使う（`test/liff-screen.test.ts` が、HTML差し込みAPIの使用を検出する） |
| 画面はユーザーIDを送らない | APIの呼び出しは `liff-api.js` の `callApi`（`Authorization` ヘッダだけを送る）を通す（同テストが、`fetch` の直接使用とユーザーIDの扱いを検出する） |
| 食事も、本人のものだけに触れる | `clients/d1.ts` の食事の全クエリが `user_id` で絞る |
| 食事の日付は、日本時間で扱う | `core/meals.ts` の `jstDate`（サーバーが「今日」を決め、画面は応答の `today` を使う） |
| Geminiの出力は検証してから使う | `handlers/suggest.ts` は、`parseSuggestion`（zod）を通ったものだけを整形する |
| 利用者の文字は、区切りを偽装できない形でプロンプトに入れる | `core/suggest.ts` が `< >` と改行を除き、希望は200文字、在庫は100件で切る |
| Geminiの呼び出しは `clients/` だけ | `clients/gemini.ts`（`handlers/` と `core/` は `fetch` を使わない） |
| チャットへの返答は Reply API | `handlers/suggest.ts` は `replyMessage` のみ。Push API は未使用 |

## 10. ファイル一覧

`src/`、`test/`、`scripts/`、`migrations/`、`public/` の全ファイルを載せる。`pnpm run check:docs` が、ここと実物の差を見つける。

| ファイル | 役割 | 追加したステップ |
| --- | --- | --- |
| `src/index.ts` | Honoのルート定義。認証ミドルウェアの適用 | 1 |
| `src/env.ts` | 環境変数とバインディングの型、リクエスト単位の変数の型 | 1 |
| `src/handlers/webhook.ts` | 署名検証と、イベントの振り分け（1対1のテキストだけを提案に回す） | 1（4で提案に置き換え） |
| `src/handlers/suggest.ts` | 在庫の取得、Gemini、検証、Replyまでの流れ | 4 |
| `src/handlers/auth.ts` | `/api/*` のトークン検証ミドルウェア | 2 |
| `src/handlers/pantry.ts` | 在庫API（GET / POST / DELETE） | 2 |
| `src/handlers/meals.ts` | 食事API（GET / POST / DELETE） | 5 |
| `src/clients/line.ts` | 署名検証、Reply API、IDトークン検証 | 1 |
| `src/clients/d1.ts` | 在庫・食事のD1操作（一覧・追加・削除） | 2（5で食事を追加） |
| `src/clients/gemini.ts` | Gemini API を呼ぶ（JSONで受ける） | 4 |
| `src/core/pantry.ts` | 在庫の型、カテゴリ、入力検証 | 2 |
| `src/core/meals.ts` | 食事の型、入力検証、日本時間の日付、日付の計算 | 5 |
| `src/core/id.ts` | パスの `:id` を正の整数に直す | 5 |
| `src/core/suggest.ts` | 提案の出力スキーマ（zod）、プロンプト（在庫・直近の食事・希望）、返信の整形、定型文 | 4（5で食事を追加） |
| `migrations/0001_create_pantry_items.sql` | `pantry_items` の作成 | 2 |
| `migrations/0002_create_meals.sql` | `meals` の作成 | 5 |
| `public/liff/index.html` | 画面の骨組み（在庫・食べたものの2タブ）。LIFF IDを持つ | 3（5でタブ化） |
| `public/liff/app.js` | 画面の入口（LIFF初期化、タブの切り替え） | 3（5で入口に絞った） |
| `public/liff/liff-api.js` | 全タブで共有する部品（LIFFの初期化、IDトークン付きAPI呼び出し、状態表示、2回押しの削除） | 5 |
| `public/liff/pantry-screen.js` | 「在庫」タブ（一覧・追加・削除） | 5 |
| `public/liff/meals-screen.js` | 「食べたもの」タブ（直近7日、追加・削除） | 5 |
| `public/liff/pantry-view.js` | 在庫の表示ロジック（区分ごとの分け方）。DOMに触れない | 3 |
| `public/liff/meals-view.js` | 食事の表示ロジック（日付の表示、同じ日のまとめ方）。DOMに触れない | 5 |
| `public/liff/style.css` | 画面のスタイル（ライト・ダーク対応） | 3 |
| `scripts/simulate.ts` | 擬似Webhookを送る | 2 |
| `scripts/try-gemini.ts` | 本物のGemini APIを1回呼んで、検証まで通るか確かめる（人間が実行） | 4 |
| `scripts/check-docs.ts` | この設計書と実物の突き合わせ | 2 |
| `scripts/node-shims.d.ts` | `@types/node` を入れていないための、最小の型宣言 | 2 |
| `test/helpers.ts` | 署名の生成、DB初期化、外部通信ガード | 1 |
| `test/env.d.ts` | テスト用バインディングの型 | 2 |
| `test/line.test.ts` | LINEクライアントのテスト | 1 |
| `test/webhook.test.ts` | Webhookのテスト | 1 |
| `test/core-pantry.test.ts` | 在庫の入力検証のテスト | 2 |
| `test/core-meals.test.ts` | 食事の入力検証・日付・パスIDのテスト | 5 |
| `test/meals-api.test.ts` | 食事APIのテスト | 5 |
| `test/core-suggest.test.ts` | 提案の純粋関数のテスト | 4 |
| `test/gemini.test.ts` | Geminiクライアントのテスト | 4 |
| `test/d1.test.ts` | D1ラッパーのテスト | 2 |
| `test/pantry-api.test.ts` | 在庫APIのテスト | 2 |
| `test/liff-view.test.ts` | 画面の表示ロジックのテスト | 3 |
| `test/liff-screen.test.ts` | 画面ファイルの中身の検査 | 3 |
| `test/raw.d.ts` | `?raw` import の型 | 3 |

設定ファイル（一覧の突き合わせの対象外）: `package.json`、`wrangler.jsonc`、`tsconfig.json`、`vitest.config.ts`、`biome.json`、`.gitignore`、`.dev.vars.example`。

## 11. 今後のステップで増えるもの（未実装）

| ステップ | 増えるもの |
| --- | --- |
| 6 | `scheduled`（cron 9:00 JST）、Push API の呼び出し。提案の流れ（`handlers/suggest.ts` の `suggestionText`）を、気分なし（「おまかせ」）で再利用する。在庫のあるユーザー全員に送る |
