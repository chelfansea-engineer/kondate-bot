import { afterEach, describe, expect, it, vi } from "vitest";
import {
  replyMessage,
  verifyIdToken,
  verifySignature,
} from "../src/clients/line";
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

describe("verifyIdToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: Response) {
    const fetchMock = vi.fn<typeof fetch>(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("LINEが認めたトークンなら、ユーザーID（sub）を返す", async () => {
    stubFetch(Response.json({ iss: "https://access.line.me", sub: "U123" }));

    expect(await verifyIdToken("id-token", "channel-id")).toBe("U123");
  });

  it("トークンとチャネルIDをフォーム形式でLINEに送る", async () => {
    const fetchMock = stubFetch(Response.json({ sub: "U123" }));

    await verifyIdToken("id-token", "channel-id");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const sent = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(sent)).toEqual({
      id_token: "id-token",
      client_id: "channel-id",
    });
  });

  it("LINEが400（期限切れ・別チャネルなど）を返したら null", async () => {
    stubFetch(Response.json({ error: "invalid_request" }, { status: 400 }));

    expect(await verifyIdToken("bad", "channel-id")).toBeNull();
  });

  it("sub が入っていない応答は null", async () => {
    stubFetch(Response.json({ iss: "https://access.line.me" }));
    expect(await verifyIdToken("t", "channel-id")).toBeNull();

    stubFetch(Response.json({ sub: "" }));
    expect(await verifyIdToken("t", "channel-id")).toBeNull();
  });

  it("LINEの障害（500）は null にせず例外にする", async () => {
    stubFetch(new Response("down", { status: 500 }));

    await expect(verifyIdToken("t", "channel-id")).rejects.toThrow("500");
  });

  it("チャネルIDが未設定（空）ならLINEを呼ばずに null", async () => {
    const fetchMock = stubFetch(Response.json({ sub: "U123" }));

    expect(await verifyIdToken("t", "")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("トークンが空ならLINEを呼ばずに null", async () => {
    const fetchMock = stubFetch(Response.json({ sub: "U123" }));

    expect(await verifyIdToken("", "channel-id")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
