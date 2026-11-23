// 食べたものの記録。日付は「日本時間の YYYY-MM-DD」で扱う

export type MealInput = {
  name: string;
  /** 食べた日（日本時間の YYYY-MM-DD） */
  eatenOn: string;
};

export type Meal = MealInput & {
  id: number;
  createdAt: string;
};

const NAME_MAX = 50;
/** 提案に反映する、直近の日数（今日を含む） */
export const RECENT_DAYS = 7;
/** 何日前まで、さかのぼって記録できるか */
const BACKDATE_DAYS = 60;

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

/** いまの日本時間の日付 */
export function jstDate(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 実在する日付なら、その日の0時（UTC）のミリ秒。そうでなければ null */
function toUtcMs(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  const exists =
    back.getUTCFullYear() === year &&
    back.getUTCMonth() === month - 1 &&
    back.getUTCDate() === day;
  return exists ? ms : null;
}

/** 日付を、日数ずらす。date が実在する日付でなければ例外 */
export function addDays(date: string, days: number): string {
  const ms = toUtcMs(date);
  if (ms === null) throw new RangeError(`invalid date: ${date}`);
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** 直近（今日を含めて RECENT_DAYS 日）の、いちばん古い日付 */
export function recentSince(today: string): string {
  return addDays(today, -(RECENT_DAYS - 1));
}

/**
 * 画面から届いた生の値を、食事の記録に変える。不正なら null。
 * eatenOn を省くと today（今日）。未来の日付と、60日より前は受け付けない。
 */
export function parseMealInput(
  value: unknown,
  today: string,
): MealInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, eatenOn } = value as Record<string, unknown>;

  if (typeof name !== "string") return null;
  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > NAME_MAX) return null;

  if (eatenOn === undefined) return { name: trimmedName, eatenOn: today };
  if (typeof eatenOn !== "string" || toUtcMs(eatenOn) === null) return null;
  // 同じ形式（YYYY-MM-DD）の文字列なので、文字列のまま日付の前後を比べられる
  if (eatenOn > today || eatenOn < addDays(today, -BACKDATE_DAYS)) return null;

  return { name: trimmedName, eatenOn };
}
