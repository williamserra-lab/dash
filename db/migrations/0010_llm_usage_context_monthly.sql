-- 0010_llm_usage_context_monthly.sql
-- Aggregated LLM token usage per month, broken down by context + actor (for billing).

CREATE TABLE IF NOT EXISTS llm_usage_context_month (
  client_id TEXT NOT NULL,
  month_key TEXT NOT NULL, -- YYYY-MM
  context TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  total_tokens BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, month_key, context, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_context_month_client_month
  ON llm_usage_context_month (client_id, month_key);
