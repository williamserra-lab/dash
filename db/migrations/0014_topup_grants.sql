-- Top-up grants (manual credits added by SUPERADMIN after payment)

CREATE TABLE IF NOT EXISTS nextia_topup_grants (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id TEXT NOT NULL,
  month_key TEXT NOT NULL, -- YYYY-MM
  request_id TEXT NULL,
  credits_granted BIGINT NOT NULL,
  amount_cents INTEGER NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  notes TEXT NULL,
  expires_at TIMESTAMPTZ NULL,
  created_by TEXT NULL,
  meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_nextia_topup_grants_client_month
ON nextia_topup_grants (client_id, month_key);

CREATE INDEX IF NOT EXISTS idx_nextia_topup_grants_request_id
ON nextia_topup_grants (request_id);
