import { describe, expect, it } from "vitest";
import {
  formatDateLabel,
  groupMealsByDate,
} from "../public/liff/meals-view.js";
import { CATEGORIES, groupByCategory } from "../public/liff/pantry-view.js";

const item = (id: number, category: string, name = `item${id}`) => ({
  id,
  name,
  category,
  memo: "",
  createdAt: "2026-11-23T00:00:00Z",
});

describe("groupByCategory", () => {
  it("食材と調味料に分け、それぞれ渡された順を保つ", () => {
    const groups = groupByCategory([
      item(1, "food", "玉ねぎ"),
      item(2, "seasoning", "醤油"),
      item(3, "food", "卵"),
      item(4, "seasoning", "味噌"),
    ]);

    expect(groups.food?.map((i) => i.name)).toEqual(["玉ねぎ", "卵"]);
    expect(groups.seasoning?.map((i) => i.name)).toEqual(["醤油", "味噌"]);
  });

  it("空でも、すべての区分のキーを返す", () => {
    expect(groupByCategory([])).toEqual({ food: [], seasoning: [] });
  });

  it("どの区分でもないものは捨てる", () => {
    const groups = groupByCategory([item(1, "drink"), item(2, "food")]);

    expect(groups.food).toHaveLength(1);
    expect(Object.values(groups).flat()).toHaveLength(1);
  });

  it("画面の区分は、APIの category と同じ値を持つ", () => {
    expect(CATEGORIES.map((c) => c.value)).toEqual(["food", "seasoning"]);
  });
});

describe("formatDateLabel", () => {
  const today = "2026-11-24";

  it("今日と昨日は、そう書く", () => {
    expect(formatDateLabel("2026-11-24", today)).toBe("今日");
    expect(formatDateLabel("2026-11-23", today)).toBe("昨日");
  });

  it("それ以外は、月/日（曜日）", () => {
    expect(formatDateLabel("2026-11-22", today)).toBe("11/22（日）");
    expect(formatDateLabel("2026-11-18", today)).toBe("11/18（水）");
  });

  it("月をまたいでも、昨日と書く", () => {
    expect(formatDateLabel("2026-11-30", "2026-12-01")).toBe("昨日");
  });

  it("月・日の先頭の0は付けない", () => {
    expect(formatDateLabel("2026-11-05", today)).toBe("11/5（木）");
  });
});

describe("groupMealsByDate", () => {
  const meal = (id: number, name: string, eatenOn: string) => ({
    id,
    name,
    eatenOn,
    createdAt: "2026-11-24T00:00:00Z",
  });

  it("同じ日をまとめ、日付と食事の並びは、渡された順を保つ", () => {
    const groups = groupMealsByDate([
      meal(4, "朝食", "2026-11-24"),
      meal(3, "夕食", "2026-11-23"),
      meal(2, "昼食", "2026-11-23"),
      meal(1, "鍋", "2026-11-20"),
    ]);

    expect(groups.map((g) => [g.date, g.meals.map((m) => m.name)])).toEqual([
      ["2026-11-24", ["朝食"]],
      ["2026-11-23", ["夕食", "昼食"]],
      ["2026-11-20", ["鍋"]],
    ]);
  });

  it("空なら、空の配列", () => {
    expect(groupMealsByDate([])).toEqual([]);
  });
});
