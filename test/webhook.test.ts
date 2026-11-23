import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMeal, addPantryItem } from "../src/clients/d1";
import { generateJson } from "../src/clients/gemini";
import { replyMessage } from "../src/clients/line";
import { EMPTY_PANTRY_REPLY, FAILURE_REPLY } from "../src/core/suggest";
import app from "../src/index";
import { blockNetwork, resetDb, sign, TEST_ENV } from "./helpers";

// LINEとGeminiへの通信は必ずモックする。署名検証とD1は本物を使う
vi.mock("../src/clients/line", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/clients/line")>();
  return { ...original, replyMessage: vi.fn(async () => {}) };
});
vi.mock("../src/clients/gemini", () => ({ generateJson: vi.fn() }));

const replyMock = vi.mocked(replyMessage);
const geminiMock = vi.mocked(generateJson);

const SUGGESTION = {
  dishes: [
    {
      name: "卵とじ味噌汁",
      reason: "さっぱり食べられる",
      uses: ["卵"],
      missing: [],
    },
  ],
};

function textEvent(
  text: string,
  options: { replyToken?: string; userId?: string; sourceType?: string } = {},
) {
  return {
    type: "message",
    replyToken: options.replyToken ?? "reply-token",
    source: {
      type: options.sourceType ?? "user",
      userId: options.userId ?? "U123",
    },
    message: { type: "text", id: "1", text },
  };
}

/** 応答のあとの処理（Gemini、Reply）が終わるまで待つ */
async function postWebhook(body: string, signature?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== undefined) headers["x-line-signature"] = signature;
  const ctx = createExecutionContext();
  const res = await app.request(
    "/webhook",
    { method: "POST", headers, body },
    TEST_ENV,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function postSigned(payload: unknown) {
  const body = JSON.stringify(payload);
  return postWebhook(body, await sign(body, TEST_ENV.LINE_CHANNEL_SECRET));
}

const onion = { name: "玉ねぎ", category: "food", memo: "2個" } as const;
const egg = { name: "卵", category: "food", memo: "" } as const;
const soy = { name: "醤油", category: "seasoning", memo: "" } as const;

describe("POST /webhook", () => {
  beforeEach(async () => {
    // 日本時間で 2026-11-24 の朝9時30分。直近7日の境目を、実際の日付に頼らず確かめるため
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T00:30:00Z"));
    blockNetwork();
    await resetDb();
    replyMock.mockReset();
    replyMock.mockResolvedValue(undefined);
    geminiMock.mockReset();
    geminiMock.mockResolvedValue(SUGGESTION);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("献立の提案", () => {
    it("在庫と気分から提案を作り、Reply で返す", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      await addPantryItem(TEST_ENV.DB, "U123", soy);

      const res = await postSigned({ events: [textEvent("さっぱりしたい")] });

      expect(res.status).toBe(200);
      expect(replyMock).toHaveBeenCalledTimes(1);
      const [token, text, accessToken] = replyMock.mock.calls[0] ?? [];
      expect(token).toBe("reply-token");
      expect(accessToken).toBe(TEST_ENV.LINE_CHANNEL_ACCESS_TOKEN);
      expect(text).toContain("今夜の献立の提案です。");
      expect(text).toContain("1. 卵とじ味噌汁");
    });

    it("Geminiには、在庫と気分と、環境変数のキー・モデルIDを渡す", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      await addPantryItem(TEST_ENV.DB, "U123", soy);

      await postSigned({ events: [textEvent("さっぱりしたい")] });

      expect(geminiMock).toHaveBeenCalledTimes(1);
      const input = geminiMock.mock.calls[0]?.[0];
      expect(input?.apiKey).toBe(TEST_ENV.GEMINI_API_KEY);
      expect(input?.model).toBe(TEST_ENV.GEMINI_MODEL);
      expect(input?.user).toContain("- 玉ねぎ（2個）");
      expect(input?.user).toContain("- 醤油");
      expect(input?.user).toContain("<request>\nさっぱりしたい\n</request>");
    });

    it("送信者本人の在庫だけを、プロンプトに入れる", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", {
        ...onion,
        name: "Aさんの玉ねぎ",
      });
      await addPantryItem(TEST_ENV.DB, "U456", { ...egg, name: "Bさんの卵" });

      await postSigned({ events: [textEvent("x", { userId: "U456" })] });

      const user = geminiMock.mock.calls[0]?.[0].user ?? "";
      expect(user).toContain("Bさんの卵");
      expect(user).not.toContain("Aさんの玉ねぎ");
    });

    it("最近7日の食事を、プロンプトに入れる（8日前は入れない）", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      await addMeal(TEST_ENV.DB, "U123", {
        name: "昨日のカレー",
        eatenOn: "2026-11-23",
      });
      await addMeal(TEST_ENV.DB, "U123", {
        name: "6日前の鍋",
        eatenOn: "2026-11-18",
      });
      await addMeal(TEST_ENV.DB, "U123", {
        name: "7日前の丼",
        eatenOn: "2026-11-17",
      });

      await postSigned({ events: [textEvent("x")] });

      const user = geminiMock.mock.calls[0]?.[0].user ?? "";
      expect(user).toContain("- 11/23（昨日） 昨日のカレー");
      expect(user).toContain("- 11/18 6日前の鍋");
      expect(user).not.toContain("7日前の丼");
    });

    it("送信者本人の食事だけを、プロンプトに入れる", async () => {
      await addPantryItem(TEST_ENV.DB, "U456", egg);
      await addMeal(TEST_ENV.DB, "U123", {
        name: "Aさんの鍋",
        eatenOn: "2026-11-23",
      });
      await addMeal(TEST_ENV.DB, "U456", {
        name: "Bさんのカレー",
        eatenOn: "2026-11-23",
      });

      await postSigned({ events: [textEvent("x", { userId: "U456" })] });

      const user = geminiMock.mock.calls[0]?.[0].user ?? "";
      expect(user).toContain("Bさんのカレー");
      expect(user).not.toContain("Aさんの鍋");
    });

    it("食事が1件もなくても、提案を返す", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);

      await postSigned({ events: [textEvent("x")] });

      expect(geminiMock.mock.calls[0]?.[0].user).toContain(
        "<meals>\n- なし\n</meals>",
      );
      expect(replyMock).toHaveBeenCalledTimes(1);
    });

    it("複数のメッセージに、それぞれ返す", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      await addPantryItem(TEST_ENV.DB, "U456", egg);

      await postSigned({
        events: [
          textEvent("一つ目", { replyToken: "token-1", userId: "U123" }),
          textEvent("二つ目", { replyToken: "token-2", userId: "U456" }),
        ],
      });

      expect(replyMock.mock.calls.map(([token]) => token).sort()).toEqual([
        "token-1",
        "token-2",
      ]);
      expect(geminiMock).toHaveBeenCalledTimes(2);
    });

    it("在庫が空なら、Geminiを呼ばずに登録をうながす", async () => {
      await postSigned({ events: [textEvent("何か作りたい")] });

      expect(geminiMock).not.toHaveBeenCalled();
      expect(replyMock).toHaveBeenCalledWith(
        "reply-token",
        EMPTY_PANTRY_REPLY,
        TEST_ENV.LINE_CHANNEL_ACCESS_TOKEN,
      );
    });

    it("Geminiが失敗したら、お詫びを返す", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      geminiMock.mockRejectedValue(new Error("Gemini API failed: 429"));

      const res = await postSigned({ events: [textEvent("x")] });

      expect(res.status).toBe(200);
      expect(replyMock).toHaveBeenCalledWith(
        "reply-token",
        FAILURE_REPLY,
        TEST_ENV.LINE_CHANNEL_ACCESS_TOKEN,
      );
      consoleError.mockRestore();
    });

    it("Geminiの出力が想定の形でなければ、お詫びを返す（そのまま送らない）", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      // 形は近いが、料理名が上限（40文字）を超えている。検証がなければ、そのまま送られる
      geminiMock.mockResolvedValue({
        dishes: [{ ...SUGGESTION.dishes[0], name: "あ".repeat(41) }],
      });

      await postSigned({ events: [textEvent("x")] });

      expect(replyMock).toHaveBeenCalledTimes(1);
      expect(replyMock.mock.calls[0]?.[1]).toBe(FAILURE_REPLY);
      consoleError.mockRestore();
    });

    it("Replyが失敗しても200を返し、残りのイベントも処理する", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      await addPantryItem(TEST_ENV.DB, "U456", egg);
      replyMock.mockRejectedValueOnce(new Error("LINE Reply API failed: 500"));

      const res = await postSigned({
        events: [
          textEvent("一つ目", { replyToken: "token-1", userId: "U123" }),
          textEvent("二つ目", { replyToken: "token-2", userId: "U456" }),
        ],
      });

      expect(res.status).toBe(200);
      expect(replyMock).toHaveBeenCalledTimes(2);
      consoleError.mockRestore();
    });

    it("Geminiの完了を待たずに、先に200を返す", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      let finishGemini: (value: unknown) => void = () => {};
      geminiMock.mockReturnValue(
        new Promise((resolve) => {
          finishGemini = resolve;
        }),
      );
      const body = JSON.stringify({ events: [textEvent("x")] });
      const ctx = createExecutionContext();

      const res = await app.request(
        "/webhook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-signature": await sign(body, TEST_ENV.LINE_CHANNEL_SECRET),
          },
          body,
        },
        TEST_ENV,
        ctx,
      );

      expect(res.status).toBe(200);
      expect(replyMock).not.toHaveBeenCalled();

      finishGemini(SUGGESTION);
      await waitOnExecutionContext(ctx);
      expect(replyMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("署名と、扱わないイベント", () => {
    it("不正な署名なら401で、在庫もGeminiもReplyも使わない", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);
      const body = JSON.stringify({ events: [textEvent("やあ")] });

      const res = await postWebhook(body, await sign(body, "wrong-secret"));

      expect(res.status).toBe(401);
      expect(geminiMock).not.toHaveBeenCalled();
      expect(replyMock).not.toHaveBeenCalled();
    });

    it("署名ヘッダがなければ401で、何もしない", async () => {
      const res = await postWebhook(
        JSON.stringify({ events: [textEvent("やあ")] }),
      );

      expect(res.status).toBe(401);
      expect(geminiMock).not.toHaveBeenCalled();
      expect(replyMock).not.toHaveBeenCalled();
    });

    it("テキスト以外のイベントは無視して200", async () => {
      const res = await postSigned({
        events: [
          {
            type: "message",
            replyToken: "t",
            source: { type: "user", userId: "U123" },
            message: { type: "sticker", id: "2" },
          },
          {
            type: "follow",
            replyToken: "t",
            source: { type: "user", userId: "U123" },
          },
        ],
      });

      expect(res.status).toBe(200);
      expect(geminiMock).not.toHaveBeenCalled();
      expect(replyMock).not.toHaveBeenCalled();
    });

    it("グループやルームの発言には答えない", async () => {
      await addPantryItem(TEST_ENV.DB, "U123", onion);

      const res = await postSigned({
        events: [
          textEvent("x", { sourceType: "group" }),
          textEvent("x", { sourceType: "room" }),
        ],
      });

      expect(res.status).toBe(200);
      expect(geminiMock).not.toHaveBeenCalled();
      expect(replyMock).not.toHaveBeenCalled();
    });

    it("送信者のIDがないイベントは無視する", async () => {
      const res = await postSigned({
        events: [
          {
            type: "message",
            replyToken: "t",
            source: { type: "user" },
            message: { type: "text", id: "1", text: "x" },
          },
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
  });
});
