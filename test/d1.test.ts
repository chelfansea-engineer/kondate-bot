import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addMeal,
  addPantryItem,
  deleteMeal,
  deletePantryItem,
  listMeals,
  listPantryItems,
} from "../src/clients/d1";
import { resetDb } from "./helpers";

const onion = { name: "玉ねぎ", category: "food", memo: "2個" } as const;
const soy = { name: "醤油", category: "seasoning", memo: "" } as const;

describe("pantry D1 client", () => {
  beforeEach(resetDb);

  it("追加した在庫を一覧で読み戻せる", async () => {
    const added = await addPantryItem(env.DB, "U1", onion);

    expect(added).toMatchObject({ ...onion });
    expect(added.id).toBeGreaterThan(0);
    expect(added.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await listPantryItems(env.DB, "U1")).toEqual([added]);
  });

  it("一覧は追加順で返る", async () => {
    await addPantryItem(env.DB, "U1", onion);
    await addPantryItem(env.DB, "U1", soy);

    const items = await listPantryItems(env.DB, "U1");
    expect(items.map((item) => item.name)).toEqual(["玉ねぎ", "醤油"]);
  });

  it("一覧は自分の在庫だけ返す", async () => {
    await addPantryItem(env.DB, "U1", onion);
    await addPantryItem(env.DB, "U2", soy);

    const items = await listPantryItems(env.DB, "U1");
    expect(items.map((item) => item.name)).toEqual(["玉ねぎ"]);
  });

  it("自分の在庫は消せて、一覧から無くなる", async () => {
    const added = await addPantryItem(env.DB, "U1", onion);

    expect(await deletePantryItem(env.DB, "U1", added.id)).toBe(true);
    expect(await listPantryItems(env.DB, "U1")).toEqual([]);
  });

  it("他人の在庫は消せず、残る", async () => {
    const added = await addPantryItem(env.DB, "U1", onion);

    expect(await deletePantryItem(env.DB, "U2", added.id)).toBe(false);
    expect(await listPantryItems(env.DB, "U1")).toEqual([added]);
  });

  it("存在しないIDを消そうとすると false", async () => {
    expect(await deletePantryItem(env.DB, "U1", 9999)).toBe(false);
  });

  it("DBの制約が、未知のカテゴリを弾く", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO pantry_items (user_id, name, category) VALUES ('U1', 'x', 'drink')",
      ).run(),
    ).rejects.toThrow();
  });
});

describe("meals D1 client", () => {
  beforeEach(resetDb);

  const curry = { name: "カレー", eatenOn: "2026-11-23" };
  const salad = { name: "サラダ", eatenOn: "2026-11-24" };

  it("追加した食事を、日付の新しい順で読み戻せる", async () => {
    const a = await addMeal(env.DB, "U1", curry);
    const b = await addMeal(env.DB, "U1", salad);

    expect(a).toMatchObject(curry);
    expect(a.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await listMeals(env.DB, "U1", "2026-11-01")).toEqual([b, a]);
  });

  it("同じ日は、あとから追加したものが先", async () => {
    const first = await addMeal(env.DB, "U1", curry);
    const second = await addMeal(env.DB, "U1", { ...curry, name: "味噌汁" });

    expect(await listMeals(env.DB, "U1", "2026-11-01")).toEqual([
      second,
      first,
    ]);
  });

  it("since より前の食事は返さない（since 当日は含む）", async () => {
    await addMeal(env.DB, "U1", { name: "古い", eatenOn: "2026-11-17" });
    const edge = await addMeal(env.DB, "U1", {
      name: "境目",
      eatenOn: "2026-11-18",
    });

    expect(await listMeals(env.DB, "U1", "2026-11-18")).toEqual([edge]);
  });

  it("自分の食事だけ返す", async () => {
    await addMeal(env.DB, "U1", curry);
    await addMeal(env.DB, "U2", salad);

    const meals = await listMeals(env.DB, "U1", "2026-11-01");
    expect(meals.map((m) => m.name)).toEqual(["カレー"]);
  });

  it("自分の食事は消せて、他人の食事は消せない", async () => {
    const mine = await addMeal(env.DB, "U1", curry);

    expect(await deleteMeal(env.DB, "U2", mine.id)).toBe(false);
    expect(await listMeals(env.DB, "U1", "2026-11-01")).toEqual([mine]);
    expect(await deleteMeal(env.DB, "U1", mine.id)).toBe(true);
    expect(await listMeals(env.DB, "U1", "2026-11-01")).toEqual([]);
  });

  it("存在しないIDを消そうとすると false", async () => {
    expect(await deleteMeal(env.DB, "U1", 9999)).toBe(false);
  });
});
