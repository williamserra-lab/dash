-- db/migrations/0003_preorders.sql
-- Pré-pedidos (ponte entre bot e humano).
-- Idempotent.

CREATE TABLE IF NOT EXISTS nextia_preorders (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS nextia_preorders_client_updated_idx
ON nextia_preorders (client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS nextia_preorders_client_status_idx
ON nextia_preorders (client_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS nextia_preorders_client_contact_idx
ON nextia_preorders (client_id, contact_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS nextia_preorders_client_identifier_idx
ON nextia_preorders (client_id, identifier, updated_at DESC);
