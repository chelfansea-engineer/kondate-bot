import { beforeEach, describe, expect, it, vi } from "vitest";
import { replyMessage } from "../src/clients/line";
import app from "../src/index";
import { sign, TEST_ENV } from "./helpers";

// LINEへの通信は必ずモックする。署名検証は本物を使う
vi.mock("../src/clients/line", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/clients/line")>();
  return { ...original, replyMessage: vi.fn(async () => {}) };
});

const replyMock = vi.mocked(replyMessage);

function textEvent(text: string, replyToken = "reply-token") {
  return {
    type: "message",
    replyToken,
    source: { type: "user", userId: "U123" },
    message: { type: "text", id: "1", text },
  };
}

async function postWebhook(body: string, signature?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== undefined) headers["x-line-signature"] = signature;
  return app.request("/webhook", { method: "POST", headers, body }, TEST_ENV);
}

async function postSigned(payload: unknown) {
  const body = JSON.stringify(payload);
  return postWebhook(body, await sign(body, TEST_ENV.LINE_CHANNEL_SECRET));
}

describe("POST /webhook", () => {
  beforeEach(() => {
    replyMock.mockReset();
    replyMock.mockResolvedValue(undefined);
  });

  it("正しい署名のテキストメッセージをオウム返しする", async () => {
    const res = await postSigned({ events: [textEvent("今日は寒いね")] });

    expect(res.status).toBe(200);
    expect(replyMock).toHaveBeenCalledTimes(1);
    expect(replyMock).toHaveBeenCalledWith(
      "reply-token",
      "今日は寒いね",
      TEST_ENV.LINE_CHANNEL_ACCESS_TOKEN,
    );
  });

  it("複数のテキストメッセージにそれぞれ返す", async () => {
    const res = await postSigned({
      events: [textEvent("一つ目", "token-1"), textEvent("二つ目", "token-2")],
    });

    expect(res.status).toBe(200);
    expect(replyMock.mock.calls.map(([token, text]) => [token, text])).toEqual([
      ["token-1", "一つ目"],
      ["token-2", "二つ目"],
    ]);
  });

  it("不正な署名なら401で、返信しない", async () => {
    const body = JSON.stringify({ events: [textEvent("やあ")] });
    const res = await postWebhook(body, await sign(body, "wrong-secret"));

    expect(res.status).toBe(401);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("署名ヘッダがなければ401で、返信しない", async () => {
    const res = await postWebhook(
      JSON.stringify({ events: [textEvent("やあ")] }),
    );

    expect(res.status).toBe(401);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("テキスト以外のイベントは無視して200", async () => {
    const res = await postSigned({
      events: [
        {
          type: "message",
          replyToken: "t",
          message: { type: "sticker", id: "2" },
        },
        { type: "follow", replyToken: "t" },
      ],
    });

    expect(res.status).toBe(200);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("イベントが空（疎通確認）なら200", async () => {
    const res = await postSigned({ events: [] });

    expect(res.status).toBe(200);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("返信に失敗しても200を返し、残りのイベントも処理する", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    replyMock.mockRejectedValueOnce(new Error("LINE Reply API failed: 500"));

    const res = await postSigned({
      events: [textEvent("一つ目", "token-1"), textEvent("二つ目", "token-2")],
    });

    expect(res.status).toBe(200);
    expect(replyMock).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
