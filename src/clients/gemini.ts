// Gemini API の薄いラッパー。リクエストの形の違いは、このファイルだけで吸収する

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 20_000;

export type GenerateJsonInput = {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** 返してほしいJSONの形（JSONスキーマ） */
  schema: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 応答の candidates[0].content.parts[].text を、つないで取り出す */
function extractText(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.candidates)) {
    throw new Error("Gemini API returned no candidates");
  }
  const content = isRecord(body.candidates[0])
    ? body.candidates[0].content
    : undefined;
  const parts = isRecord(content) ? content.parts : undefined;
  if (!Array.isArray(parts)) {
    throw new Error("Gemini API returned no content");
  }
  const text = parts
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .join("");
  if (!text) throw new Error("Gemini API returned empty text");
  return text;
}

/**
 * 指示を送り、JSONで返ってきた値を返す。形の検証は呼び出し側（zod）で行う。
 * 失敗したら例外を投げる。
 */
export async function generateJson(input: GenerateJsonInput): Promise<unknown> {
  if (!input.apiKey) throw new Error("GEMINI_API_KEY is not set");

  const res = await fetch(
    `${ENDPOINT}/${encodeURIComponent(input.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts: [{ text: input.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: input.schema,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Gemini API failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
  }

  const text = extractText(await res.json());
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Gemini API returned text that is not JSON");
  }
}
