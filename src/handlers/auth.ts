import { createMiddleware } from "hono/factory";
import { verifyIdToken } from "../clients/line";
import type { AppEnv } from "../env";

/**
 * /api/* の入口。Authorization: Bearer <LIFFのIDトークン> をLINEのサーバーで検証し、
 * 検証で得たユーザーIDだけを c.var.userId に入れる。
 * ボディやクエリのユーザーIDは、ここより先では誰も読まない。
 */
export const requireLiffUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: "unauthorized" }, 401);

  const userId = await verifyIdToken(token, c.env.LIFF_CHANNEL_ID);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  c.set("userId", userId);
  await next();
});
