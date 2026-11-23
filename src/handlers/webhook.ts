import type { Context } from "hono";
import { verifySignature } from "../clients/line";
import type { Env } from "../env";
import { replyWithSuggestion } from "./suggest";

type TextMessageEvent = {
  type: "message";
  replyToken: string;
  /** 1対1のトークだけを扱う（グループの発言には答えない） */
  source: { type: "user"; userId: string };
  message: { type: "text"; text: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextMessageEvent(event: unknown): event is TextMessageEvent {
  if (!isRecord(event)) return false;
  if (event.type !== "message") return false;
  if (typeof event.replyToken !== "string") return false;
  const source = event.source;
  if (
    !isRecord(source) ||
    source.type !== "user" ||
    typeof source.userId !== "string"
  ) {
    return false;
  }
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

  // Geminiは数秒かかるので、LINEには先に200を返し、提案と返信は応答のあとで行う。
  // 1件の失敗が残りを止めないよう、イベントごとに独立して動かす
  for (const event of extractEvents(rawBody)) {
    if (!isTextMessageEvent(event)) continue;
    c.executionCtx.waitUntil(
      replyWithSuggestion(c.env, {
        replyToken: event.replyToken,
        userId: event.source.userId,
        text: event.message.text,
      }),
    );
  }
  return c.text("ok");
}
