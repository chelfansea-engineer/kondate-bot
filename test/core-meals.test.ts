import { describe, expect, it } from "vitest";
import { parseId } from "../src/core/id";
import {
  addDays,
  jstDate,
  parseMealInput,
  recentSince,
} from "../src/core/meals";

const TODAY = "2026-11-24";

describe("jstDate", () => {
  it("日本時間の日付を返す（UTCの午後3時で、日付が変わる）", () => {
    expect(jstDate(new Date("2026-11-23T14:59:59Z"))).toBe("2026-11-23");
    expect(jstDate(new Date("2026-11-23T15:00:00Z"))).toBe("2026-11-24");
  });

  it("朝9時のcron（UTC 0時）は、その日の日付", () => {
    expect(jstDate(new Date("2026-11-24T00:00:00Z"))).toBe("2026-11-24");
  });

  it("年をまたぐ", () => {
    expect(jstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("addDays", () => {
  it.each([
    ["2026-11-24", -1, "2026-11-23"],
    ["2026-11-24", 0, "2026-11-24"],
    ["2026-12-01", -1, "2026-11-30"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2024-03-01", -1, "2024-02-29"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2026-11-24", 7, "2026-12-01"],
  ])("%s を %i 日ずらすと %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("実在しない日付は例外", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });
});

describe("recentSince", () => {
  it("今日を含めて7日の、いちばん古い日", () => {
    expect(recentSince("2026-11-24")).toBe("2026-11-18");
  });
});

describe("parseMealInput", () => {
  it("名前と日付を返す", () => {
    expect(
      parseMealInput({ name: "カレー", eatenOn: "2026-11-23" }, TODAY),
    ).toEqual({ name: "カレー", eatenOn: "2026-11-23" });
  });

  it("日付を省くと、今日", () => {
    expect(parseMealInput({ name: "カレー" }, TODAY)).toEqual({
      name: "カレー",
      eatenOn: TODAY,
    });
  });

  it("名前の前後の空白を取り除く", () => {
    expect(parseMealInput({ name: "  カレー " }, TODAY)?.name).toBe("カレー");
  });

  it("今日と、60日前ちょうどは通す", () => {
    expect(parseMealInput({ name: "x", eatenOn: TODAY }, TODAY)).not.toBeNull();
    expect(
      parseMealInput({ name: "x", eatenOn: "2026-09-25" }, TODAY),
    ).not.toBeNull();
  });

  it("余計な項目（userId など）は結果に含めない", () => {
    expect(
      parseMealInput({ name: "x", userId: "attacker", user_id: "a" }, TODAY),
    ).toEqual({ name: "x", eatenOn: TODAY });
  });

  it.each([
    ["オブジェクトでない", "カレー"],
    ["null", null],
    ["名前がない", { eatenOn: TODAY }],
    ["名前が空白だけ", { name: "  " }],
    ["名前が数値", { name: 1 }],
    ["名前が51文字", { name: "あ".repeat(51) }],
    ["日付が文字列でない", { name: "x", eatenOn: 20261123 }],
    ["日付の形式が違う", { name: "x", eatenOn: "2026/11/23" }],
    ["日付が実在しない", { name: "x", eatenOn: "2026-02-30" }],
    ["明日", { name: "x", eatenOn: "2026-11-25" }],
    ["61日前", { name: "x", eatenOn: "2026-09-24" }],
  ])("不正な入力は null: %s", (_label, value) => {
    expect(parseMealInput(value, TODAY)).toBeNull();
  });
});

describe("parseId", () => {
  it.each(["1", "42", "999999999999999"])("正の整数: %s", (id) => {
    expect(parseId(id)).toBe(Number(id));
  });

  it.each(["", "0", "-1", "1.5", "abc", "01", "1e3", "1234567890123456"])(
    "整数でなければ null: %s",
    (id) => {
      expect(parseId(id)).toBeNull();
    },
  );
});
