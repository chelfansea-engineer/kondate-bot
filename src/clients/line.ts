const REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

const encoder = new TextEncoder();

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * LINEのWebhook署名を検証する。
 * 生のボディをチャネルシークレットでHMAC-SHA256にかけた結果と、
 * x-line-signature ヘッダ（base64）を照合する。
 */
export async function verifySignature(
  rawBody: string,
  signature: string | null | undefined,
  channelSecret: string,
): Promise<boolean> {
  // シークレット未設定のときは検証しようがないので、必ず拒否する
  if (!signature || !channelSecret) return false;
  const signatureBytes = decodeBase64(signature);
  if (!signatureBytes) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(rawBody),
  );
}

/** Reply API でテキストを1通返す。失敗したら例外を投げる。 */
export async function replyMessage(
  replyToken: string,
  text: string,
  channelAccessToken: string,
): Promise<void> {
  const res = await fetch(REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE Reply API failed: ${res.status} ${await res.text()}`);
  }
}
