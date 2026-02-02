-- 0013_topup_requests.sql
-- Adds credit topup request tracking for manual billing operations.

CREATE TABLE IF NOT EXISTS nextia_credit_topup_requests (
  id uuid PRIMARY KEY,
  client_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  usage_percent integer NOT NULL DEFAULT 0,
  credits_used bigint NOT NULL DEFAULT 0,
  monthly_limit bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  resolved_at timestamptz NULL,
  resolved_by text NULL,
  resolution_note text NULL,
  meta jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_nextia_credit_topup_requests_client_id ON nextia_credit_topup_requests (client_id);
CREATE INDEX IF NOT EXISTS idx_nextia_credit_topup_requests_status ON nextia_credit_topup_requests (status);
