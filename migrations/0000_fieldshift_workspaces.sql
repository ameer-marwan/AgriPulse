CREATE TABLE IF NOT EXISTS fieldshift_workspaces (
  user_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
