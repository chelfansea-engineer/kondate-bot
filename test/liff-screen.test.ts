import { describe, expect, it } from "vitest";
import appJs from "../public/liff/app.js?raw";
import html from "../public/liff/index.html?raw";
import liffApiJs from "../public/liff/liff-api.js?raw";
import mealsScreenJs from "../public/liff/meals-screen.js?raw";
import mealsViewJs from "../public/liff/meals-view.js?raw";
import pantryScreenJs from "../public/liff/pantry-screen.js?raw";
import pantryViewJs from "../public/liff/pantry-view.js?raw";

// 画面ファイルの中身の検査。配信そのもの（wrangler の assets）は wrangler dev で確かめる
// （テスト環境の SELF は静的アセットを返さないため）

const SCRIPTS = {
  "app.js": appJs,
  "liff-api.js": liffApiJs,
  "meals-screen.js": mealsScreenJs,
  "meals-view.js": mealsViewJs,
  "pantry-screen.js": pantryScreenJs,
  "pantry-view.js": pantryViewJs,
};

describe("LIFF画面（index.html）", () => {
  it("スクリプトの読み込みがある", () => {
    expect(html).toContain('src="app.js"');
    expect(html).toContain("https://static.line-scdn.net/liff/edge/2/sdk.js");
  });

  it("LIFF ID が入っている（形式のみ確認）", () => {
    const id = html.match(/<meta name="liff-id" content="([^"]+)"/)?.[1];

    expect(id).toMatch(/^\d+-[A-Za-z0-9]+$/);
  });

  it("「在庫」「食べたもの」のタブと、それぞれのパネルがある", () => {
    for (const id of [
      "tab-pantry",
      "tab-meals",
      "panel-pantry",
      "panel-meals",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("パネルは、読み込みが終わるまで隠しておく（イベントを付ける前に送信させない）", () => {
    expect(html).toMatch(/id="panel-pantry"[^>]*hidden/);
    expect(html).toMatch(/id="panel-meals"[^>]*hidden/);
  });

  describe("在庫タブ", () => {
    it("追加フォームと一覧がある", () => {
      expect(html).toContain('id="add-form"');
      expect(html).toContain('id="list-food"');
      expect(html).toContain('id="list-seasoning"');
    });

    it("入力欄の上限が、APIの検証（名前50・メモ200文字）と同じ", () => {
      expect(html).toMatch(
        /id="add-form"[\s\S]*?name="name"[^>]*maxlength="50"/,
      );
      expect(html).toMatch(/name="memo"[^>]*maxlength="200"/);
    });

    it("区分の選択肢は、APIの category と同じ値", () => {
      expect(html).toContain('name="category" value="food"');
      expect(html).toContain('name="category" value="seasoning"');
    });
  });

  describe("食べたものタブ", () => {
    it("記録フォーム（日付と料理名）と一覧がある", () => {
      expect(html).toContain('id="meal-form"');
      expect(html).toMatch(/type="date"[^>]*name="eatenOn"/);
      expect(html).toContain('id="meal-list"');
    });

    it("料理名の上限が、APIの検証（50文字）と同じ", () => {
      expect(html).toMatch(
        /id="meal-form"[\s\S]*?name="name"[^>]*maxlength="50"/,
      );
    });
  });
});

describe("LIFF画面のJS", () => {
  it.each(Object.entries(SCRIPTS))(
    "%s は、HTMLを文字列で差し込む API を使わない（名前は文字としてだけ出す）",
    (_file, source) => {
      expect(source).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      );
    },
  );

  it.each(Object.entries(SCRIPTS))(
    "%s は、ユーザーIDを扱わない（サーバーがIDトークンから取り出す）",
    (_file, source) => {
      expect(source).not.toMatch(/user_?id/i);
    },
  );

  it("APIの呼び出しは、IDトークンを Authorization ヘッダで送る入口（callApi）を通す", () => {
    expect(liffApiJs).toContain("Authorization");
    for (const source of [pantryScreenJs, mealsScreenJs]) {
      expect(source).toContain("callApi(");
      expect(source).not.toContain("fetch(");
    }
  });
});
