import { afterEach, describe, expect, it, vi } from "vitest";
import { replyMessage, verifySignature } from "../src/clients/line";
import { sign } from "./helpers";

const SECRET = "test-channel-secret";
const BODY = JSON.stringify({ events: [] });

describe("verifySignature", () => {
  it("正しい署名なら true", async () => {
    const signature = await sign(BODY, SECRET);
    expect(await verifySignature(BODY, signature, SECRET)).toBe(true);
  });

  it("別のシークレットで作った署名なら false", async () => {
    const signature = await sign(BODY, "other-secret");
    expect(await verifySignature(BODY, signature, SECRET)).toBe(false);
  });

  it("ボディが改ざんされていたら false", async () => {
    const signature = await sign(BODY, SECRET);
    expect(await verifySignature(`${BODY} `, signature, SECRET)).toBe(false);
  });

  it("署名がない・空なら false", async () => {
    expect(await verifySignature(BODY, undefined, SECRET)).toBe(false);
    expect(await verifySignature(BODY, null, SECRET)).toBe(false);
    expect(await verifySignature(BODY, "", SECRET)).toBe(false);
  });

  it("シークレットが未設定（空）なら false", async () => {
    const signature = await sign(BODY, SECRET);
    expect(await verifySignature(BODY, signature, "")).toBe(false);
  });

  it("base64として壊れた署名なら false", async () => {
    expect(await verifySignature(BODY, "!!!not-base64!!!", SECRET)).toBe(false);
  });
});

describe("replyMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Reply API に replyToken とテキストを送る", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await replyMessage("reply-token", "こんにちは", "access-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.line.me/v2/bot/message/reply");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer access-token",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      replyToken: "reply-token",
      messages: [{ type: "text", text: "こんにちは" }],
    });
  });

  it("Reply API がエラーを返したら例外を投げる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () => new Response("bad request", { status: 400 }),
      ),
    );

    await expect(replyMessage("t", "x", "access-token")).rejects.toThrow("400");
  });
});
