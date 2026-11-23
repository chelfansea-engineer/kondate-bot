export const CATEGORIES = ["food", "seasoning"] as const;
export type Category = (typeof CATEGORIES)[number];

export type PantryInput = {
  name: string;
  category: Category;
  memo: string;
};

export type PantryItem = PantryInput & {
  id: number;
  createdAt: string;
};

const NAME_MAX = 50;
const MEMO_MAX = 200;

function isCategory(value: unknown): value is Category {
  return CATEGORIES.some((category) => category === value);
}

/** 画面から届いた生の値を、在庫の入力に変える。不正なら null */
export function parsePantryInput(value: unknown): PantryInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, category, memo } = value as Record<string, unknown>;

  if (typeof name !== "string") return null;
  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > NAME_MAX) return null;

  if (!isCategory(category)) return null;

  if (memo !== undefined && typeof memo !== "string") return null;
  const trimmedMemo = (memo ?? "").trim();
  if (trimmedMemo.length > MEMO_MAX) return null;

  return { name: trimmedName, category, memo: trimmedMemo };
}
