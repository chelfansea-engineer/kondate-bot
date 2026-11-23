import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addPantryItem,
  deletePantryItem,
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
