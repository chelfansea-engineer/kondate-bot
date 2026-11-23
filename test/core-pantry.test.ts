import { describe, expect, it } from "vitest";
import { parsePantryInput } from "../src/core/pantry";

describe("parsePantryInput", () => {
  it("正しい入力をそのまま返す", () => {
    expect(
      parsePantryInput({ name: "玉ねぎ", category: "food", memo: "2個" }),
    ).toEqual({ name: "玉ねぎ", category: "food", memo: "2個" });
  });

  it("memo がなければ空文字にする", () => {
    expect(parsePantryInput({ name: "醤油", category: "seasoning" })).toEqual({
      name: "醤油",
      category: "seasoning",
      memo: "",
    });
  });

  it("名前とメモの前後の空白を取り除く", () => {
    expect(
      parsePantryInput({
        name: "  卵 ",
        category: "food",
        memo: " 賞味期限近い ",
      }),
    ).toEqual({ name: "卵", category: "food", memo: "賞味期限近い" });
  });

  it("余計な項目（userId など）は結果に含めない", () => {
    const result = parsePantryInput({
      name: "卵",
      category: "food",
      userId: "attacker",
      user_id: "attacker",
    });
    expect(result).toEqual({ name: "卵", category: "food", memo: "" });
  });

  it.each([
    ["オブジェクトでない", "卵"],
    ["null", null],
    ["配列", []],
    ["名前がない", { category: "food" }],
    ["名前が空白だけ", { name: "   ", category: "food" }],
    ["名前が数値", { name: 1, category: "food" }],
    ["名前が51文字", { name: "あ".repeat(51), category: "food" }],
    ["カテゴリがない", { name: "卵" }],
    ["カテゴリが未知の値", { name: "卵", category: "drink" }],
    ["メモが文字列でない", { name: "卵", category: "food", memo: 1 }],
    ["メモが201文字", { name: "卵", category: "food", memo: "あ".repeat(201) }],
  ])("不正な入力は null: %s", (_label, value) => {
    expect(parsePantryInput(value)).toBeNull();
  });

  it("名前50文字・メモ200文字ちょうどは通す", () => {
    expect(
      parsePantryInput({
        name: "あ".repeat(50),
        category: "food",
        memo: "い".repeat(200),
      }),
    ).not.toBeNull();
  });
});
