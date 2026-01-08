-- db/migrations/0011_llm_usage_context_monthly.sql
-- LLM usage ledger per clientId, month, and context (YYYY-MM).
-- Idempotent schema.

CREATE TABLE IF NOT EXISTS nextia_llm_usage_context_monthly (
  client_id TEXT NOT NULL,
  month_key TEXT NOT NULL, -- YYYY-MM
  context TEXT NOT NULL,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, month_key, context)
);

CREATE INDEX IF NOT EXISTS idx_nextia_llm_usage_context_monthly_month
  ON nextia_llm_usage_context_monthly (month_key);

CREATE INDEX IF NOT EXISTS idx_nextia_llm_usage_context_monthly_client
  ON nextia_llm_usage_context_monthly (client_id);
