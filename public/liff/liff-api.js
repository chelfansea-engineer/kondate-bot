// 全タブで共有する部品: LIFFの初期化、IDトークン付きのAPI呼び出し、状態の表示、2回押しの削除
// 描画は textContent だけで行う（HTMLを文字列で差し込む API は使わない）

/* global liff */

const ARMED_MS = 3000;
const RELOGIN_KEY = "kondate:relogin";

const statusEl = document.getElementById("status");

export function setStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

/** LIFFを初期化する。外部ブラウザでは、ログイン画面に移動して false を返す */
export async function initLiff() {
  const liffId = document.querySelector('meta[name="liff-id"]')?.content ?? "";
  await liff.init({ liffId, withLoginOnExternalBrowser: true });
  return liff.isLoggedIn();
}

/**
 * APIに渡すIDトークン。期限が近ければ、ログインし直す（null を返す）。
 * ログインし直しても取れないときは、無限に繰り返さず例外にする。
 */
function currentIdToken() {
  const decoded = liff.getDecodedIDToken();
  if (decoded && decoded.exp * 1000 > Date.now() + 60_000) {
    sessionStorage.removeItem(RELOGIN_KEY);
    return liff.getIDToken();
  }
  if (sessionStorage.getItem(RELOGIN_KEY)) {
    throw new Error(
      "IDトークンを取得できません。LIFFの Scope に openid が必要です",
    );
  }
  sessionStorage.setItem(RELOGIN_KEY, "1");
  liff.logout();
  liff.login();
  return null;
}

/**
 * IDトークンを付けて、APIを呼ぶ。ユーザーIDは送らない（サーバーがトークンから取り出す）。
 * @returns {Promise<Response | null>} ログインし直しに移ったときは null
 */
export async function callApi(path, init = {}) {
  const token = currentIdToken();
  if (token === null) return null;
  const headers = { Authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, { ...init, headers });
}

/** 押し間違い防止。1回目で「本当に削除」に変わり、3秒以内にもう一度押すと onConfirm を呼ぶ */
export function armedDelete(button, onConfirm) {
  button.addEventListener("click", () => {
    if (button.dataset.armed !== "1") {
      button.dataset.armed = "1";
      button.textContent = "本当に削除";
      setTimeout(() => {
        button.dataset.armed = "";
        button.textContent = "削除";
      }, ARMED_MS);
      return;
    }
    onConfirm();
  });
}
