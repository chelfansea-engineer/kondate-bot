import { describe, expect, it } from "vitest";
import appJs from "../public/liff/app.js?raw";
import html from "../public/liff/index.html?raw";
import viewJs from "../public/liff/pantry-view.js?raw";

// 画面ファイルの中身の検査。配信そのもの（wrangler の assets）は wrangler dev で確かめる
// （テスト環境の SELF は静的アセットを返さないため）

describe("LIFF画面（index.html）", () => {
  it("追加フォームと一覧、スクリプトの読み込みがある", () => {
    expect(html).toContain('id="add-form"');
    expect(html).toContain('id="list-food"');
    expect(html).toContain('id="list-seasoning"');
    expect(html).toContain('src="app.js"');
    expect(html).toContain("https://static.line-scdn.net/liff/edge/2/sdk.js");
  });

  it("LIFF ID が入っている（形式のみ確認）", () => {
    const id = html.match(/<meta name="liff-id" content="([^"]+)"/)?.[1];

    expect(id).toMatch(/^\d+-[A-Za-z0-9]+$/);
  });

  it("入力欄の上限が、APIの検証（名前50・メモ200文字）と同じ", () => {
    expect(html).toMatch(/name="name"[^>]*maxlength="50"/);
    expect(html).toMatch(/name="memo"[^>]*maxlength="200"/);
  });

  it("区分の選択肢は、APIの category と同じ値", () => {
    expect(html).toContain('name="category" value="food"');
    expect(html).toContain('name="category" value="seasoning"');
  });
});

describe("LIFF画面のJS", () => {
  it("HTMLを文字列で差し込む API を使わない（名前やメモは文字としてだけ出す）", () => {
    for (const source of [appJs, viewJs]) {
      expect(source).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      );
    }
  });

  it("APIには Authorization ヘッダだけでユーザーを伝え、ユーザーIDを送らない", () => {
    expect(appJs).toContain("Authorization");
    expect(appJs).not.toMatch(/user_?id/i);
  });
});
