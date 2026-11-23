import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPantryItem, listPantryItems } from "../src/clients/d1";
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

const onion = { name: "玉ねぎ", category: "food", memo: "2個" } as const;

describe("/api/pantry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    blockNetwork();
    await resetDb();
    verifyMock.mockReset();
    verifyMock.mockImplementation(async (token) => TOKENS[token] ?? null);
  });

  describe("認証", () => {
    it.each([
      ["GET", "/api/pantry"],
      ["POST", "/api/pantry"],
      ["DELETE", "/api/pantry/1"],
      ["GET", "/api/ほかのルート"],
    ])(
      "トークンなしの %s %s は401で、LINEにもDBにも触れない",
      async (method, path) => {
        const seeded = await addPantryItem(env.DB, "U-alice", onion);

        const res = await request(path, {
          method,
          body: method === "POST" ? onion : undefined,
        });

        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("玉ねぎ");
        expect(verifyMock).not.toHaveBeenCalled();
        expect(await listPantryItems(env.DB, "U-alice")).toEqual([seeded]);
      },
    );

    it("Bearer 形式でない Authorization は401", async () => {
      const res = await app.request(
        "/api/pantry",
        { headers: { Authorization: "token-alice" } },
        TEST_ENV,
      );

      expect(res.status).toBe(401);
      expect(verifyMock).not.toHaveBeenCalled();
    });

    it("LINEが認めないトークンは401で、在庫を作らない", async () => {
      const res = await request("/api/pantry", {
        method: "POST",
        token: "forged",
        body: onion,
      });

      expect(res.status).toBe(401);
      expect(await listPantryItems(env.DB, "U-alice")).toEqual([]);
    });

    it("トークンと LIFF_CHANNEL_ID を検証に渡す", async () => {
      await request("/api/pantry", { token: "token-alice" });

      expect(verifyMock).toHaveBeenCalledWith(
        "token-alice",
        TEST_ENV.LIFF_CHANNEL_ID,
      );
    });
  });

  describe("GET", () => {
    it("検証されたユーザーの在庫だけ返す", async () => {
      await addPantryItem(env.DB, "U-alice", onion);
      await addPantryItem(env.DB, "U-bob", {
        name: "醤油",
        category: "seasoning",
        memo: "",
      });

      const res = await request("/api/pantry", { token: "token-alice" });
      const body = await res.json<{ items: { name: string }[] }>();

      expect(res.status).toBe(200);
      expect(body.items.map((item) => item.name)).toEqual(["玉ねぎ"]);
    });

    it("クエリの userId は信用しない", async () => {
      await addPantryItem(env.DB, "U-bob", onion);

      const res = await request("/api/pantry?userId=U-bob&user_id=U-bob", {
        token: "token-alice",
      });
      const body = await res.json<{ items: unknown[] }>();

      expect(body.items).toEqual([]);
    });
  });

  describe("POST", () => {
    it("検証されたユーザーの在庫として保存し、201で返す", async () => {
      const res = await request("/api/pantry", {
        method: "POST",
        token: "token-alice",
        body: onion,
      });
      const body = await res.json<{ item: { id: number } }>();

      expect(res.status).toBe(201);
      expect(body.item).toMatchObject(onion);
      expect(await listPantryItems(env.DB, "U-alice")).toEqual([body.item]);
      expect(await listPantryItems(env.DB, "U-bob")).toEqual([]);
    });

    it("ボディやクエリの userId を渡されても、検証されたユーザーで保存する", async () => {
      const res = await request("/api/pantry?userId=U-bob", {
        method: "POST",
        token: "token-alice",
        body: { ...onion, userId: "U-bob", user_id: "U-bob" },
      });

      expect(res.status).toBe(201);
      expect(await listPantryItems(env.DB, "U-alice")).toHaveLength(1);
      expect(await listPantryItems(env.DB, "U-bob")).toEqual([]);
    });

    it.each([
      ["カテゴリが不正", { name: "卵", category: "drink" }],
      ["名前が空", { name: "", category: "food" }],
      ["配列", []],
    ])("不正な入力は400で、保存しない: %s", async (_label, body) => {
      const res = await request("/api/pantry", {
        method: "POST",
        token: "token-alice",
        body,
      });

      expect(res.status).toBe(400);
      expect(await listPantryItems(env.DB, "U-alice")).toEqual([]);
    });

    it("JSONでないボディは400", async () => {
      const res = await app.request(
        "/api/pantry",
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
    it("自分の在庫を消して204を返す", async () => {
      const added = await addPantryItem(env.DB, "U-alice", onion);

      const res = await request(`/api/pantry/${added.id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(204);
      expect(await listPantryItems(env.DB, "U-alice")).toEqual([]);
    });

    it("他人の在庫は404で、消えない", async () => {
      const added = await addPantryItem(env.DB, "U-bob", onion);

      const res = await request(`/api/pantry/${added.id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(404);
      expect(await listPantryItems(env.DB, "U-bob")).toEqual([added]);
    });

    it("存在しないIDは404", async () => {
      const res = await request("/api/pantry/9999", {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(404);
    });

    it.each(["abc", "0", "-1", "1.5"])("数値でないIDは400: %s", async (id) => {
      const res = await request(`/api/pantry/${id}`, {
        method: "DELETE",
        token: "token-alice",
      });

      expect(res.status).toBe(400);
    });
  });
});
