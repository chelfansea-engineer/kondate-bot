// 「在庫」タブ。一覧、追加、削除
import { armedDelete, callApi, setStatus } from "./liff-api.js";
import { groupByCategory } from "./pantry-view.js";

const API = "/api/pantry";

const formEl = document.getElementById("add-form");
const listEls = {
  food: document.getElementById("list-food"),
  seasoning: document.getElementById("list-seasoning"),
};

/** @type {import("./pantry-view.js").PantryItem[]} */
let items = [];
let bound = false;

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
  armedDelete(button, () => removeItem(item, button));

  li.append(text, button);
  return li;
}

async function removeItem(item, button) {
  button.disabled = true;
  try {
    const res = await callApi(`${API}/${item.id}`, { method: "DELETE" });
    if (res === null) return;
    // 404 は、すでに消えている（別の端末で消したなど）。画面からも外す
    if (res.status !== 204 && res.status !== 404) {
      throw new Error(String(res.status));
    }
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
    const res = await callApi(API, {
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

/** 一覧を取得して表示する。ログインし直しに移ったときは false */
export async function loadPantry() {
  const res = await callApi(API);
  if (res === null) return false;
  if (!res.ok) throw new Error(String(res.status));
  ({ items } = await res.json());
  render();
  if (!bound) {
    formEl.addEventListener("submit", onSubmit);
    bound = true;
  }
  return true;
}
