import type { Context } from "hono";
import { replyMessage, verifySignature } from "../clients/line";
import type { Env } from "../env";

type TextMessageEvent = {
  type: "message";
  replyToken: string;
  message: { type: "text"; text: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextMessageEvent(event: unknown): event is TextMessageEvent {
  if (!isRecord(event)) return false;
  if (event.type !== "message") return false;
  if (typeof event.replyToken !== "string") return false;
  const message = event.message;
  return (
    isRecord(message) &&
    message.type === "text" &&
    typeof message.text === "string"
  );
}

function extractEvents(rawBody: string): unknown[] {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return [];
  }
  if (!isRecord(body) || !Array.isArray(body.events)) return [];
  return body.events;
}

export async function handleWebhook(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  // 署名は生のボディに対して計算されるので、JSONパースより前に検証する
  const rawBody = await c.req.text();
  const signature = c.req.header("x-line-signature");
  const valid = await verifySignature(
    rawBody,
    signature,
    c.env.LINE_CHANNEL_SECRET,
  );
  if (!valid) {
    return c.text("invalid signature", 401);
  }

  for (const event of extractEvents(rawBody)) {
    if (!isTextMessageEvent(event)) continue;
    try {
      await replyMessage(
        event.replyToken,
        event.message.text,
        c.env.LINE_CHANNEL_ACCESS_TOKEN,
      );
    } catch (error) {
      // 返信に失敗してもLINEには200を返す（1件の失敗で残りを止めない）
      console.error(error);
    }
  }
  return c.text("ok");
}
