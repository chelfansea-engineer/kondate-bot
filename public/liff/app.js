// LIFF（LINEの中で開くWeb画面）の本体。フレームワークは使わない。
// 描画は textContent だけで行う（HTMLを文字列で差し込む API は使わない。名前やメモに何が入っていても、そのまま文字として出す）
import { groupByCategory } from "./pantry-view.js";

/* global liff */

const API = "/api/pantry";
const ARMED_MS = 3000;
const RELOGIN_KEY = "kondate:relogin";

const liffId = document.querySelector('meta[name="liff-id"]')?.content ?? "";
const statusEl = document.getElementById("status");
const formEl = document.getElementById("add-form");
const listsEl = document.getElementById("lists");
const listEls = {
  food: document.getElementById("list-food"),
  seasoning: document.getElementById("list-seasoning"),
};

/** @type {import("./pantry-view.js").PantryItem[]} */
let items = [];

function setStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
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

/** @returns {Promise<Response | null>} ログインし直しに移ったときは null */
async function callApi(path, init = {}) {
  const token = currentIdToken();
  if (token === null) return null;
  const headers = { Authorization: `Bearer ${token}` };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${API}${path}`, { ...init, headers });
}

function render() {
  const groups = groupByCategory(items);
  for (const [category, listEl] of Object.entries(listEls)) {
    const group = groups[category] ?? [];
    listEl.replaceChildren(
      ...(group.length > 0 ? group.map(renderItem) : [renderEmpty()]),
    );
  }
}

function renderEmpty() {
  const li = document.createElement("li");
  li.className = "empty";
  li.textContent = "まだありません";
  return li;
}

function renderItem(item) {
  const li = document.createElement("li");

  const text = document.createElement("div");
  text.className = "item-text";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = item.name;
  text.append(name);
  if (item.memo) {
    const memo = document.createElement("span");
    memo.className = "memo";
    memo.textContent = item.memo;
    text.append(memo);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "delete";
  button.textContent = "削除";
  button.setAttribute("aria-label", `${item.name}を削除`);
  button.addEventListener("click", () => onDeleteClick(item, button));

  li.append(text, button);
  return li;
}

/** 押し間違い防止。1回目で「本当に削除」に変わり、3秒以内にもう一度押すと消す */
function onDeleteClick(item, button) {
  if (button.dataset.armed !== "1") {
    button.dataset.armed = "1";
    button.textContent = "本当に削除";
    setTimeout(() => {
      button.dataset.armed = "";
      button.textContent = "削除";
    }, ARMED_MS);
    return;
  }
  void removeItem(item, button);
}

async function removeItem(item, button) {
  button.disabled = true;
  try {
    const res = await callApi(`/${item.id}`, { method: "DELETE" });
    if (res === null) return;
    // 404 は、すでに消えている（別の端末で消したなど）。画面からも外す
    if (res.status !== 204 && res.status !== 404)
      throw new Error(String(res.status));
    items = items.filter((current) => current.id !== item.id);
    setStatus("");
    render();
  } catch (error) {
    console.error(error);
    button.disabled = false;
    setStatus("削除できませんでした。もう一度試してください。", "error");
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const submit = formEl.querySelector('button[type="submit"]');
  const data = new FormData(formEl);
  submit.disabled = true;
  try {
    const res = await callApi("", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        category: data.get("category"),
        memo: data.get("memo"),
      }),
    });
    if (res === null) return;
    if (res.status === 400) {
      setStatus(
        "入力を確認してください（名前は1〜50文字、メモは200文字まで）。",
        "error",
      );
      return;
    }
    if (res.status !== 201) throw new Error(String(res.status));
    const { item } = await res.json();
    items = [...items, item];
    setStatus("");
    render();
    formEl.reset();
    formEl.elements.name.focus();
  } catch (error) {
    console.error(error);
    setStatus("追加できませんでした。もう一度試してください。", "error");
  } finally {
    submit.disabled = false;
  }
}

async function loadItems() {
  const res = await callApi("");
  if (res === null) return false;
  if (!res.ok) throw new Error(String(res.status));
  ({ items } = await res.json());
  return true;
}

async function main() {
  try {
    await liff.init({ liffId, withLoginOnExternalBrowser: true });
    // 外部ブラウザでは、ここでログイン画面に移動する
    if (!liff.isLoggedIn()) return;
    if (!(await loadItems())) return;
    render();
    formEl.hidden = false;
    listsEl.hidden = false;
    formEl.addEventListener("submit", onSubmit);
    setStatus("");
  } catch (error) {
    console.error(error);
    setStatus(
      "画面を開けませんでした。LINEの画面を開き直してください。",
      "error",
    );
  }
}

void main();
