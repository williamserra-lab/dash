-- db/migrations/0002_llm_usage_monthly.sql
-- LLM usage ledger per clientId and month (YYYY-MM).
-- Idempotent schema (safe to run multiple times).

CREATE TABLE IF NOT EXISTS nextia_llm_usage_monthly (
  client_id TEXT NOT NULL,
  month_key TEXT NOT NULL, -- YYYY-MM
  total_tokens BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  provider TEXT NULL,
  model TEXT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_nextia_llm_usage_monthly_month
  ON nextia_llm_usage_monthly (month_key);
