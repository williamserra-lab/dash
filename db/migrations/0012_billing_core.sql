-- db/migrations/0012_billing_core.sql
-- Billing/Plans core (PostgreSQL).
-- Idempotent migration (IF NOT EXISTS).

-- Plans (templates of entitlements + pricing)
CREATE TABLE IF NOT EXISTS nextia_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  price_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  entitlements JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_instructions JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nextia_plans_status_idx
ON nextia_plans (status);

-- Client billing state
CREATE TABLE IF NOT EXISTS nextia_client_billing (
  client_id TEXT PRIMARY KEY,
  plan_id TEXT NULL,
  billing_status TEXT NOT NULL DEFAULT 'active', -- active | grace | suspended
  contract_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  grace_days INTEGER NOT NULL DEFAULT 5,
  grace_until TIMESTAMPTZ NULL,
  suspended_reason TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backward compat if an earlier draft used column name "status"
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='nextia_client_billing' AND column_name='status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='nextia_client_billing' AND column_name='billing_status'
  ) THEN
    ALTER TABLE nextia_client_billing RENAME COLUMN status TO billing_status;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS nextia_client_billing_status_idx
ON nextia_client_billing (billing_status);

-- Invoices (monthly charges)
CREATE TABLE IF NOT EXISTS nextia_invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  plan_id TEXT NULL,
  cycle_start TIMESTAMPTZ NOT NULL,
  cycle_end TIMESTAMPTZ NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | paid | overdue | canceled
  paid_at TIMESTAMPTZ NULL,
  payment_ref TEXT NULL,
  payment_instructions TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nextia_invoices_client_idx
ON nextia_invoices (client_id, due_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS nextia_invoices_client_cycle_uq
ON nextia_invoices (client_id, cycle_start, cycle_end);

-- Credit ledger (audit of credits granted/consumed)
CREATE TABLE IF NOT EXISTS nextia_credit_ledger (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- monthly_grant | topup_grant | usage_debit | manual_adjust
  amount BIGINT NOT NULL, -- positive grants, negative debits
  currency TEXT NOT NULL DEFAULT 'CREDITS',
  ref_type TEXT NULL,
  ref_id TEXT NULL,
  meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS nextia_credit_ledger_client_created_idx
ON nextia_credit_ledger (client_id, created_at DESC);

-- Seed: default plan if missing
INSERT INTO nextia_plans (id, name, status, price_cents, currency, entitlements)
SELECT 'default', 'Plano Padrão', 'active', 0, 'BRL',
  jsonb_build_object(
    'monthlyCredits', 200000,
    'maxCampaigns', 10,
    'maxSchedules', 50
  )
WHERE NOT EXISTS (SELECT 1 FROM nextia_plans WHERE id = 'default');
