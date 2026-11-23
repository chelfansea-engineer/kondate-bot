import { Hono } from "hono";
import { addMeal, deleteMeal, listMeals } from "../clients/d1";
import { parseId } from "../core/id";
import { jstDate, parseMealInput, recentSince } from "../core/meals";
import type { AppEnv } from "../env";

export const mealsRoutes = new Hono<AppEnv>();

// 「今日」はサーバーが決める（日本時間）。画面は、返ってきた today を使う
mealsRoutes.get("/", async (c) => {
  const today = jstDate(new Date());
  const meals = await listMeals(c.env.DB, c.var.userId, recentSince(today));
  return c.json({ today, meals });
});

mealsRoutes.post("/", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const input = parseMealInput(body, jstDate(new Date()));
  if (!input) return c.json({ error: "invalid input" }, 400);

  const meal = await addMeal(c.env.DB, c.var.userId, input);
  return c.json({ meal }, 201);
});

mealsRoutes.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid id" }, 400);

  const deleted = await deleteMeal(c.env.DB, c.var.userId, id);
  // 存在しない記録と他人の記録は区別しない
  if (!deleted) return c.json({ error: "not found" }, 404);
  return c.body(null, 204);
});
