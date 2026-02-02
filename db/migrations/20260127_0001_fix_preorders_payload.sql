-- db/migrations/20260127_0001_fix_preorders_payload.sql
-- Fix legacy rows where payload is NULL / 'null' (should be JSONB NOT NULL).
-- Idempotent.

ALTER TABLE IF EXISTS nextia_preorders
  ALTER COLUMN payload SET DEFAULT '{}'::jsonb;

-- Backfill bad rows (NULL or explicit JSON null)
UPDATE nextia_preorders
   SET payload = '{}'::jsonb
 WHERE payload IS NULL OR payload = 'null'::jsonb;
