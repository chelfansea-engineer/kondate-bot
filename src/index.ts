import { Hono } from "hono";
import type { Env } from "./env";
import { handleWebhook } from "./handlers/webhook";

const app = new Hono<{ Bindings: Env }>();

app.post("/webhook", handleWebhook);

export default app;
