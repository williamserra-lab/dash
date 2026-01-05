-- db/migrations/0006_preorders_expiry.sql
-- Add expires_at to preorders (idempotent).
-- Required because PreorderStatus now supports "expired" and preorders can auto-expire.

ALTER TABLE IF EXISTS nextia_preorders
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS nextia_preorders_client_expires_idx
ON nextia_preorders (client_id, expires_at ASC);
