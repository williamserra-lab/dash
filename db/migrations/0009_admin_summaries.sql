-- 0009_admin_summaries.sql
-- Generic summaries cache (admin tools): conversation/file summaries.
-- Notes:
-- - Keep it generic so we can add more summary targets later.
-- - Use id as deterministic hash to allow ON CONFLICT DO UPDATE.

CREATE TABLE IF NOT EXISTS nextia_admin_summaries (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,  -- 'conversation' | 'file'
  target_id TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,      -- 'handoff' | 'review_chat' | 'review_file'
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  summary TEXT NOT NULL,
  usage JSONB NULL,
  actor_meta JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cache key (latest per unique target+hash+purpose+provider+model+prompt_version)
CREATE UNIQUE INDEX IF NOT EXISTS nextia_admin_summaries_key
  ON nextia_admin_summaries (target_type, target_id, target_hash, purpose, provider, model, prompt_version);

CREATE INDEX IF NOT EXISTS nextia_admin_summaries_created_at
  ON nextia_admin_summaries (created_at DESC);
