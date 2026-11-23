import { Hono } from "hono";
import type { AppEnv } from "./env";
import { requireLiffUser } from "./handlers/auth";
import { mealsRoutes } from "./handlers/meals";
import { pantryRoutes } from "./handlers/pantry";
import { handleWebhook } from "./handlers/webhook";

const app = new Hono<AppEnv>();

app.post("/webhook", handleWebhook);

// /api/* は、ルートを足しても必ずLIFFトークンの検証を通る
app.use("/api/*", requireLiffUser);
app.route("/api/pantry", pantryRoutes);
app.route("/api/meals", mealsRoutes);

export default app;
