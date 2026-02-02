-- 20260113_0001_admin_credentials.sql
-- Admin credentials + session version (Postgres)
-- Design: single-row table (id=1). Password is stored as salted hash (scrypt).
-- session_version is used to invalidate existing admin sessions by bumping the version.

CREATE TABLE IF NOT EXISTS nextia_admin_credentials (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL,
  pass_algo TEXT NOT NULL DEFAULT 'scrypt',
  pass_salt_hex TEXT NOT NULL,
  pass_hash_hex TEXT NOT NULL,
  pass_n INTEGER NOT NULL DEFAULT 16384,
  pass_r INTEGER NOT NULL DEFAULT 8,
  pass_p INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure single-row semantics
CREATE UNIQUE INDEX IF NOT EXISTS nextia_admin_credentials_singleton_idx
  ON nextia_admin_credentials ((id));

-- NOTE: updated_at is handled by application code (no triggers).
