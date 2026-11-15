import type { Env } from "../src/env";

export const TEST_ENV: Env = {
  LINE_CHANNEL_SECRET: "test-channel-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "test-access-token",
};

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
