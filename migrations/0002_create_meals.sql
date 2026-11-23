-- 食べたものの記録。直近の食事を、献立の提案に反映するために使う
-- 朝・昼・晩の区別やメモは持たない（必要になったら相談してから足す）
CREATE TABLE meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  eaten_on TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_meals_user_id_eaten_on ON meals (user_id, eaten_on);
