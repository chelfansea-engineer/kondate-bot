// 「食べたもの」タブの表示用ロジック。DOM に触れない純粋な関数だけを置く（テストできるように）
// 日付は、すべて日本時間の YYYY-MM-DD

/**
 * @typedef {{ id: number, name: string, eatenOn: string, createdAt: string }} Meal
 */

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DAY_MS = 86_400_000;

/** YYYY-MM-DD の0時（UTC）のミリ秒 */
function utcMs(date) {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * 日付を、画面に出す形にする。今日・昨日は、そう書く。それ以外は「11/22（日）」。
 * @param {string} date
 * @param {string} today
 */
export function formatDateLabel(date, today) {
  const daysAgo = Math.round((utcMs(today) - utcMs(date)) / DAY_MS);
  if (daysAgo === 0) return "今日";
  if (daysAgo === 1) return "昨日";
  const [, month, day] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(utcMs(date)).getUTCDay()];
  return `${month}/${day}（${weekday}）`;
}

/**
 * 同じ日の食事をまとめる。日付の並びは、最初に出てきた順（APIは新しい順で返す）。
 * @param {Meal[]} meals
 * @returns {{ date: string, meals: Meal[] }[]}
 */
export function groupMealsByDate(meals) {
  /** @type {Map<string, Meal[]>} */
  const byDate = new Map();
  for (const meal of meals) {
    const group = byDate.get(meal.eatenOn);
    if (group) group.push(meal);
    else byDate.set(meal.eatenOn, [meal]);
  }
  return [...byDate].map(([date, group]) => ({ date, meals: group }));
}
