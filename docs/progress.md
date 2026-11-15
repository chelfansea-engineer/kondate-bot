# 進み具合

最終更新: 2026-11-15

## いまどこ

- ステップ1（オウム返しボット）… 完了。実際のLINEで「こんにちは」→「こんにちは」を確認した
- 次はステップ2（在庫API + D1のテーブル）。`pnpm run simulate` もここで作る

| ステップ | 内容 | 状態 |
| --- | --- | --- |
| 1 | オウム返しボット（Webhook + 署名検証 + Reply） | 完了 |
| 2 | 在庫API + D1のテーブル | 未着手 |
| 3 | LIFFの在庫編集画面 + リッチメニュー | 未着手 |
| 4 | チャットでの献立相談（Gemini接続） | 未着手 |
| 5 | 毎朝9時のPush | 未着手 |

## ステップ1で作ったもの

- `POST /webhook`: 署名検証 → テキストメッセージだけ Reply API でオウム返し
- 不正な署名・署名なし・シークレット未設定は401。テキスト以外と空イベントは何もせず200
- Reply API が失敗してもログを出して200を返す
- テスト15件（署名検証、Reply APIの呼び出し形、/webhook の結合）

## 決めたこと

- パッケージ管理は pnpm。コマンド表記も pnpm に統一
- lint と整形は Biome。`any` はルールでエラーにする。Markdown は対象外
- `@line/bot-sdk` は使わない。署名検証（Web Crypto）と Reply の2関数を自前で持つ
- テストは `@cloudflare/vitest-plugin`（旧名 `@cloudflare/vitest-pool-workers` は非推奨）+ vitest 5
- 型定義は `@cloudflare/workers-types` パッケージ（`wrangler types` の生成は使わない）
- zod はまだ入れない。Gemini をつなぐステップ4で足す
- 署名検証と Reply は `src/clients/line.ts` に置く。ディレクトリ構成は CLAUDE.md のまま

## ハマったこと

- **テストプールの改名**: 旧パッケージは vitest 4 系までしか対応せず、同梱ランタイムも古くて `compatibility_date` を下げる必要があった。新パッケージに入れ替えて解消
- **シークレット未設定で500**: `.dev.vars` が無いと HMAC の鍵が空になり例外が出た。空なら検証失敗（401）にした
- **Biome が Markdown も整形する**: CLAUDE.md の表を書き換え、手編集のたびに check が落ちたので対象外にした
- **dev サーバーの止め忘れ**: 残ったプロセスが8787を占有し、次の起動が8788になった
- **Webhook URL**: 末尾の `/webhook` が無いと検証が404になる。ブラウザで開いた場合の404は正常（POST専用のため）
- **トンネル**: `pnpm run dev` の画面で `t` を押すと公開URLが出る。URLは起動のたびに変わるので、LINEコンソールへの登録もやり直す

## 人間がやること（残り）

- 常時動かすにはデプロイが必要（`wrangler deploy` と、`wrangler secret put` で2つのシークレットを登録）
- `pnpm install` 時のビルドスクリプト警告（esbuild / workerd）を消すなら `pnpm approve-builds`
