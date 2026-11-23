import { applyD1Migrations, env } from "cloudflare:test";
import { vi } from "vitest";
import type { Env } from "../src/env";

export const TEST_ENV: Env = {
  LINE_CHANNEL_SECRET: "test-channel-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
  LIFF_CHANNEL_ID: "test-liff-channel-id",
  DB: env.DB,
};

/**
 * テスト中の外部通信を失敗させる。モックが効かなくなったときに、
 * 本物のLINE APIなどを黙って叩かないための保険。afterEach で vi.unstubAllGlobals() する。
 */
export function blockNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`テスト中の外部通信は禁止: ${String(input)}`);
    }),
  );
}

let migrated: Promise<void> | undefined;

/**
 * DBにスキーマを入れ、在庫を空にする。各テストの beforeEach で呼ぶ。
 * setupFiles は使わない。cloudflare:test を先に読み込むとWorker本体が
 * 本物の clients をキャッシュしてしまい、テスト側の vi.mock が効かなくなる。
 */
export async function resetDb(): Promise<void> {
  migrated ??= applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await migrated;
  await env.DB.prepare("DELETE FROM pantry_items").run();
}

/** LINEと同じ方法（HMAC-SHA256 → base64）で署名を作る */
export async function sign(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}
