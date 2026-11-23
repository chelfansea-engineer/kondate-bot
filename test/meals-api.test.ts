import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addMeal, listMeals } from "../src/clients/d1";
import { verifyIdToken } from "../src/clients/line";
import app from "../src/index";
import { blockNetwork, resetDb, TEST_ENV } from "./helpers";

// LINEへの通信は必ずモックする。トークン検証の結果だけを差し替える
vi.mock("../src/clients/line", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/clients/line")>();
  return { ...original, verifyIdToken: vi.fn() };
});

const verifyMock = vi.mocked(verifyIdToken);

const TOKENS: Record<string, string> = {
  "token-alice": "U-alice",
  "token-bob": "U-bob",
};

// 日本時間で 2026-11-24 の朝9時30分
const NOW = new Date("2026-11-24T00:30:00Z");
const TODAY = "2026-11-24";

function request(
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(
    path,
    {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    TEST_ENV,
  );
}

describe("/api/meals", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    blockNetwork();
    await resetDb();
    verifyMock.mockReset();
    verifyMock.mockImplementation(async (token) => TOKENS[token] ?? null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["GET", "/api/meals"],
    ["POST", "/api/meals"],
    ["DELETE", "/api/meals/1"],
  ])("トークンなしの %s %s は401", async (method, path) => {
    const seeded = await addMeal(env.DB, "U-alice", {
      name: "カレー",
      eatenOn: TODAY,
    });

    const res = await request(path, {
      method,
      body: method === "POST" ? { name: "x" } : undefined,
    });

    expect(res.status).toBe(401);
    expect(await listMeals(env.DB, "U-alice", "2026-01-01")).toEqual([seeded]);
  });

  describe("GET", () => {
    it("今日（日本時間）と、直近7日の自分の食事を、新しい順で返す", async () => {
      await addMeal(env.DB, "U-alice", {
        name: "7日前",
        eatenOn: "2026-11-17",
      });
      await addMeal(env.DB, "U-alice", {
        name: "6日前",
        eatenOn: "2026-11-18",
      });
      await addMeal(env.DB, "U-alice", { name: "昨日", eatenOn: "2026-11-23" });
      await addMeal(env.DB, "U-alice", { name: "今日", eatenOn: TODAY });
      await addMeal(env.DB, "U-bob", { name: "他人", eatenOn: TODAY });

      const res = await request("/api/meals", { token: "token-alice" });
      const body = await res.json<{
        today: string;
        meals: { name: string }[];
      }>();

      expect(res.status).toBe(200);
      expect(body.today).toBe(TODAY);
      expect(body.meals.map((m) => m.name)).toEqual(["今日", "昨日", "6日前"]);
    });

    it("クエリの userId は信用しない", async () => {
      await addMeal(env.DB, "U-bob", { name: "他人", eatenOn: TODAY });

      const res = await request("/api/meals?userId=U-bob", {
        token: "token-alice",
      });
      const body = await res.json<{ meals: unknown[] }>();

      expect(body.meals).toEqual([]);
    });
  });

  describe("POST", () => {
    it("日付を省くと、今日の食事として保存し、201で返す", async () => {
      const res = await request("/api/meals", {
        method: "POST",
        token: "token-alice",
        body: { name: "  カレー " },
      });
      const body = await res.json<{ meal: { id: number } }>();

      expect(res.status).toBe(201);
      expect(body.meal).toMatchObject({ name: "カレー", eatenOn: TODAY });
      expect(await listMeals(env.DB, "U-alice", "2026-01-01")).toEqual([
        body.meal,
      ]);
    });

    it("昨日の日付で記録できる", async () => {
      const res = await request("/api/meals", {
        method: "POST",
        token: "token-alice",
        body: { name: "鍋", eatenOn: "2026-11-23" },
      });

      expect(res.status).toBe(201);
      expect(
        (await listMeals(env.DB, "U-alice", "2026-01-01")).map(
          (m) => m.eatenOn,
        ),
      ).toEqual(["2026-11-23"]);
    });

    it("ボディやクエリの userId を渡されても、検証されたユーザーで保存する", async () => {
      const res = await request("/api/meals?userId=U-bob", {
        method: "POST",
        token: "token-alice",
        body: { name: "カレー", userId: "U-bob", user_id: "U-bob" },
      });

      expect(res.status).toBe(201);
      expect(await listMeals(env.DB, "U-alice", "2026-01-01")).toHaveLength(1);
      expect(await listMeals(env.DB, "U-bob", "2026-01-01")).toEqual([]);
    });

    it.each([
      ["名前が空", { name: "" }],
      ["名前がない", { eatenOn: TODAY }],
      ["明日の日付", { name: "x", eatenOn: "2026-11-25" }],
      ["61日前の日付", { name: "x", eatenOn: "2026-09-24" }],
      ["日付の形式が違う", { name: "x", eatenOn: "11/23" }],
      ["配列", []],
    ])("不正な入力は400で、保存しない: %s", async (_label, body) => {
      const res = await request("/api/meals", {
        method: "POST",
        token: "token-alice",
        body,
      });

      expect(res.status).toBe(400);
      expect(await listMeals(env.DB, "U-alice", "2026-01-01")).toEqual([]);
    });

    it("JSONでないボディは400", async () => {
      const res = await app.request(
        "/api/meals",
        {
          method: "POST",
          headers: { Authorization: "Bearer token-alice" },
          body: "not json",
        },
        TEST_ENV,
      );

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("自分の食事を消して204を返す", async () => {
      const meal = await addMeal(env.DB, "U-alice", {
        name: "カレー",
        eatenOn: TODAY,
      });

      const res = await request(`/api/meals/${meal.id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(204);
      expect(await listMeals(env.DB, "U-alice", "2026-01-01")).toEqual([]);
    });

    it("他人の食事は404で、消えない", async () => {
      const meal = await addMeal(env.DB, "U-bob", {
        name: "カレー",
        eatenOn: TODAY,
      });

      const res = await request(`/api/meals/${meal.id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(404);
      expect(await listMeals(env.DB, "U-bob", "2026-01-01")).toEqual([meal]);
    });

    it("存在しないIDは404", async () => {
      const res = await request("/api/meals/9999", {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(404);
    });

    it.each(["abc", "0", "-1", "1.5"])("数値でないIDは400: %s", async (id) => {
      const res = await request(`/api/meals/${id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(400);
    });
  });
});
