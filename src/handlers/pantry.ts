import { Hono } from "hono";
import {
  addPantryItem,
  deletePantryItem,
  listPantryItems,
} from "../clients/d1";
import { parsePantryInput } from "../core/pantry";
import type { AppEnv } from "../env";

export const pantryRoutes = new Hono<AppEnv>();

pantryRoutes.get("/", async (c) => {
  const items = await listPantryItems(c.env.DB, c.var.userId);
  return c.json({ items });
});

pantryRoutes.post("/", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const input = parsePantryInput(body);
  if (!input) return c.json({ error: "invalid input" }, 400);

  const item = await addPantryItem(c.env.DB, c.var.userId, input);
  return c.json({ item }, 201);
});

pantryRoutes.delete("/:id", async (c) => {
  const idParam = c.req.param("id");
  if (!/^[1-9]\d*$/.test(idParam)) return c.json({ error: "invalid id" }, 400);

  const deleted = await deletePantryItem(
    c.env.DB,
    c.var.userId,
    Number(idParam),
  );
  // 存在しない在庫と他人の在庫は区別しない
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.body(null, 204);
});
