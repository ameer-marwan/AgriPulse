CREATE TABLE IF NOT EXISTS fs_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  salt TEXT,
  provider TEXT NOT NULL DEFAULT 'email',
  avatar TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fs_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES fs_users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fs_sessions_user ON fs_sessions(user_id);
CREATE INDEX IF NOT EXISTS fs_sessions_expiry ON fs_sessions(expires_at);
CREATE TABLE IF NOT EXISTS fs_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES fs_users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fs_auth_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS fs_google (
  subject TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES fs_users(id) ON DELETE CASCADE
);
