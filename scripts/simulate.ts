/**
 * 擬似Webhookを送って、/webhook の署名検証と応答を確かめる。
 *
 *   LINE_CHANNEL_SECRET=<チャネルシークレット> pnpm run simulate [URL] [本文]
 *
 * - URL の既定は http://localhost:8787。先に `pnpm run dev` を動かしておく。
 * - 手元の .dev.vars を使うなら（人間が実行する）:
 *     node --env-file=.dev.vars scripts/simulate.ts
 * - 正しい署名で200、でたらめな署名で401が返れば成功（終了コード0）。
 * - replyToken は偽物なので、サーバー側のログにReply APIの失敗が出る。
 *   署名検証とイベント処理の確認が目的で、LINEへの返信は届かない。
 */

// トップレベル await のため、ファイルをモジュールにする
export {};

const DEFAULT_URL = "http://localhost:8787";

const secret = process.env.LINE_CHANNEL_SECRET;
if (!secret) {
  console.error(
    "LINE_CHANNEL_SECRET が未設定です。例: LINE_CHANNEL_SECRET=xxxx pnpm run simulate",
  );
  process.exit(1);
}
const baseUrl = process.argv[2] ?? DEFAULT_URL;
const text = process.argv[3] ?? "こんにちは";

async function sign(body: string, channelSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const body = JSON.stringify({
  destination: "Usimulate",
  events: [
    {
      type: "message",
      mode: "active",
      timestamp: Date.now(),
      source: { type: "user", userId: "Usimulate" },
      webhookEventId: "simulate",
      deliveryContext: { isRedelivery: false },
      replyToken: "simulate-reply-token",
      message: { type: "text", id: "1", text },
    },
  ],
});

async function post(signature: string): Promise<number> {
  const res = await fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": signature,
    },
    body,
  });
  return res.status;
}

const cases = [
  { label: "正しい署名", signature: await sign(body, secret), expected: 200 },
  { label: "でたらめな署名", signature: "AAAA", expected: 401 },
];

let failed = false;
for (const { label, signature, expected } of cases) {
  try {
    const status = await post(signature);
    const ok = status === expected;
    failed ||= !ok;
    console.log(
      `${ok ? "OK  " : "NG  "} ${label}: ${status}（期待 ${expected}）`,
    );
  } catch {
    console.error(
      `NG   ${baseUrl} につながりません。pnpm run dev を起動しましたか？`,
    );
    process.exit(1);
  }
}
process.exit(failed ? 1 : 0);
