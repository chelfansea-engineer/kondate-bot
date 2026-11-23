import { describe, expect, it } from "vitest";
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
