// 「食べたもの」タブ。直近7日の記録、追加、削除
import { armedDelete, callApi, setStatus } from "./liff-api.js";
import { formatDateLabel, groupMealsByDate } from "./meals-view.js";

const API = "/api/meals";

const formEl = document.getElementById("meal-form");
const listEl = document.getElementById("meal-list");

/** サーバーが決めた「今日」（日本時間） */
let today = "";
/** @type {import("./meals-view.js").Meal[]} */
let meals = [];
let bound = false;

function render() {
  if (meals.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "直近7日の記録はまだありません";
    listEl.replaceChildren(empty);
    return;
  }
  listEl.replaceChildren(
    ...groupMealsByDate(meals).map((group) => renderGroup(group)),
  );
}

function renderGroup({ date, meals: group }) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = formatDateLabel(date, today);
  const ul = document.createElement("ul");
  ul.append(...group.map(renderMeal));
  section.append(heading, ul);
  return section;
}

function renderMeal(meal) {
  const li = document.createElement("li");

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = meal.name;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "delete";
  button.textContent = "削除";
  button.setAttribute("aria-label", `${meal.name}を削除`);
  armedDelete(button, () => removeMeal(meal, button));

  li.append(name, button);
  return li;
}

/** 一覧を取り直す。日付の入力欄の上限（今日）も合わせる */
async function refresh() {
  const res = await callApi(API);
  if (res === null) return false;
  if (!res.ok) throw new Error(String(res.status));
  ({ today, meals } = await res.json());
  const dateInput = formEl.elements.eatenOn;
  dateInput.max = today;
  if (!dateInput.value) dateInput.value = today;
  render();
  return true;
}

async function removeMeal(meal, button) {
  button.disabled = true;
  try {
    const res = await callApi(`${API}/${meal.id}`, { method: "DELETE" });
    if (res === null) return;
    // 404 は、すでに消えている。画面からも外す
    if (res.status !== 204 && res.status !== 404) {
      throw new Error(String(res.status));
    }
    meals = meals.filter((current) => current.id !== meal.id);
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
        eatenOn: data.get("eatenOn"),
      }),
    });
    if (res === null) return;
    if (res.status === 400) {
      setStatus(
        "入力を確認してください（料理名は1〜50文字、日付は今日までの、60日以内）。",
        "error",
      );
      return;
    }
    if (res.status !== 201) throw new Error(String(res.status));
    setStatus("");
    // 日付しだいで、直近7日の一覧に出ないこともある。サーバーの答えで取り直す
    await refresh();
    formEl.elements.name.value = "";
    formEl.elements.name.focus();
  } catch (error) {
    console.error(error);
    setStatus("追加できませんでした。もう一度試してください。", "error");
  } finally {
    submit.disabled = false;
  }
}

/** 一覧を取得して表示する。ログインし直しに移ったときは false */
export async function loadMeals() {
  if (!(await refresh())) return false;
  if (!bound) {
    formEl.addEventListener("submit", onSubmit);
    bound = true;
  }
  return true;
}
