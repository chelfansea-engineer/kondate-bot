import { afterEach, describe, expect, it, vi } from "vitest";
import { generateJson } from "../src/clients/gemini";

const input = {
  apiKey: "secret-key",
  model: "gemini-test",
  system: "システム指示",
  user: "ユーザーの入力",
  schema: { type: "object", properties: { a: { type: "string" } } },
};

function geminiResponse(text: string): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("generateJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("返ってきたJSON文字列を、値にして返す", async () => {
    stubFetch(geminiResponse('{"a":"b"}'));

    expect(await generateJson(input)).toEqual({ a: "b" });
  });

  it("モデルごとのURLに、APIキーをヘッダで送る（URLには入れない）", async () => {
    const fetchMock = stubFetch(geminiResponse("{}"));

    await generateJson(input);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(String(url)).not.toContain("secret-key");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("secret-key");
  });

  it("システム指示・ユーザーの入力・JSONスキーマを、1回のリクエストで送る", async () => {
    const fetchMock = stubFetch(geminiResponse("{}"));

    await generateJson(input);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      systemInstruction: { parts: [{ text: "システム指示" }] },
      contents: [{ role: "user", parts: [{ text: "ユーザーの入力" }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: input.schema,
      },
    });
  });

  it("複数のpartに分かれた応答は、つないでから読む", async () => {
    stubFetch(
      Response.json({
        candidates: [
          { content: { parts: [{ text: '{"a":' }, { text: '"b"}' }] } },
        ],
      }),
    );

    expect(await generateJson(input)).toEqual({ a: "b" });
  });

  it("HTTPエラーは例外にする（ステータスを含み、APIキーは含まない）", async () => {
    stubFetch(new Response("quota exceeded", { status: 429 }));

    const error = await generateJson(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("429");
    expect((error as Error).message).not.toContain("secret-key");
  });

  it.each([
    [
      "candidates がない（安全性のブロックなど）",
      Response.json({ promptFeedback: {} }),
    ],
    ["candidates が空", Response.json({ candidates: [] })],
    [
      "content がない",
      Response.json({ candidates: [{ finishReason: "SAFETY" }] }),
    ],
    ["テキストが空", geminiResponse("")],
    ["JSONでないテキスト", geminiResponse("すみません、できません")],
  ])("応答が使えなければ例外にする: %s", async (_label, response) => {
    stubFetch(response);

    await expect(generateJson(input)).rejects.toThrow();
  });

  it("APIキーが未設定（空）なら、Googleを呼ばずに例外にする", async () => {
    const fetchMock = stubFetch(geminiResponse("{}"));

    await expect(generateJson({ ...input, apiKey: "" })).rejects.toThrow(
      "GEMINI_API_KEY",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
