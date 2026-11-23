import type { Category, PantryInput, PantryItem } from "../core/pantry";

type PantryRow = {
  id: number;
  name: string;
  category: Category;
  memo: string;
  created_at: string;
};

function toItem(row: PantryRow): PantryItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    memo: row.memo,
    createdAt: row.created_at,
  };
}

// どの関数も userId で絞る。他人の在庫は読めず、消せない

export async function listPantryItems(
  db: D1Database,
  userId: string,
): Promise<PantryItem[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, category, memo, created_at FROM pantry_items WHERE user_id = ? ORDER BY id",
    )
    .bind(userId)
    .all<PantryRow>();
  return results.map(toItem);
}

export async function addPantryItem(
  db: D1Database,
  userId: string,
  input: PantryInput,
): Promise<PantryItem> {
  const row = await db
    .prepare(
      "INSERT INTO pantry_items (user_id, name, category, memo) VALUES (?, ?, ?, ?) RETURNING id, name, category, memo, created_at",
    )
    .bind(userId, input.name, input.category, input.memo)
    .first<PantryRow>();
  if (!row) throw new Error("D1 insert returned no row");
  return toItem(row);
}

/** 消せたら true。存在しない、または他人の在庫なら false */
export async function deletePantryItem(
  db: D1Database,
  userId: string,
  id: number,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM pantry_items WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return result.meta.changes > 0;
}
