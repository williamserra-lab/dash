-- db/migrations/20260127_0002_heal_preorders_payload_notnull.sql
-- Heal legacy preorders rows where payload is NULL/'null' and add safe defaults.
-- Idempotent.

ALTER TABLE IF EXISTS nextia_preorders
  ALTER COLUMN payload SET DEFAULT '{}'::jsonb;

UPDATE nextia_preorders
   SET payload = '{}'::jsonb
 WHERE payload IS NULL OR payload = 'null'::jsonb;
