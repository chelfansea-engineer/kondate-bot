// LIFF（LINEの中で開くWeb画面）の入口。フレームワークは使わない。
// 「在庫」「食べたもの」の2つのタブを切り替える。?tab=pantry / ?tab=meals で、開くタブを選べる
import { initLiff, setStatus } from "./liff-api.js";
import { loadMeals } from "./meals-screen.js";
import { loadPantry } from "./pantry-screen.js";

const TABS = {
  pantry: {
    button: document.getElementById("tab-pantry"),
    panel: document.getElementById("panel-pantry"),
    load: loadPantry,
    loaded: false,
  },
  meals: {
    button: document.getElementById("tab-meals"),
    panel: document.getElementById("panel-meals"),
    load: loadMeals,
    loaded: false,
  },
};

/** 選んだタブ（読み込みの途中で、別のタブに切り替えられることがある） */
let current = "";

async function select(name) {
  current = name;
  for (const [key, tab] of Object.entries(TABS)) {
    const active = key === name;
    tab.button.setAttribute("aria-selected", String(active));
    // 読み込みが終わるまで、フォームを見せない（イベントを付ける前に送信されないように）
    tab.panel.hidden = !(active && tab.loaded);
  }

  const tab = TABS[name];
  if (tab.loaded) return;
  setStatus("読み込み中…");
  try {
    // ログインし直しに移ったとき（false）は、読み込み中のままにする
    tab.loaded = await tab.load();
    if (tab.loaded && current === name) {
      tab.panel.hidden = false;
      setStatus("");
    }
  } catch (error) {
    console.error(error);
    setStatus(
      "画面を開けませんでした。LINEの画面を開き直してください。",
      "error",
    );
  }
}

async function main() {
  try {
    // 外部ブラウザでは、ここでログイン画面に移動する
    if (!(await initLiff())) return;
    for (const [name, tab] of Object.entries(TABS)) {
      tab.button.addEventListener("click", () => void select(name));
    }
    // LIFFのURLに付けたクエリは、初期化のあとに location へ反映される
    const requested = new URLSearchParams(location.search).get("tab");
    await select(
      requested !== null && Object.hasOwn(TABS, requested)
        ? requested
        : "pantry",
    );
  } catch (error) {
    console.error(error);
    setStatus(
      "画面を開けませんでした。LINEの画面を開き直してください。",
      "error",
    );
  }
}

void main();
