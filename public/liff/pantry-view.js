// 画面の表示用ロジック。DOM に触れない純粋な関数だけを置く（テストできるように）

/**
 * @typedef {{ id: number, name: string, category: string, memo: string, createdAt: string }} PantryItem
 */

/** 画面に出す区分。value はAPIの category と同じ */
export const CATEGORIES = [
  { value: "food", label: "食材" },
  { value: "seasoning", label: "調味料" },
];

/**
 * 区分ごとに分ける。各区分の中の順序は、渡された順のまま。
 * どの区分にも当てはまらないものは捨てる（APIは food / seasoning しか返さない）。
 * @param {PantryItem[]} items
 * @returns {Record<string, PantryItem[]>}
 */
export function groupByCategory(items) {
  return Object.fromEntries(
    CATEGORIES.map(({ value }) => [
      value,
      items.filter((item) => item.category === value),
    ]),
  );
}
