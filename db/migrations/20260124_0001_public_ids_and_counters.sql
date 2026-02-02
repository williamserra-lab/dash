-- db/migrations/20260124_0001_public_ids_and_counters.sql
-- Human-friendly public identifiers + per-client counters.
-- Idempotent.

-- 1) Per-client counters (atomic seq generator)
CREATE TABLE IF NOT EXISTS nextia_counters (
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  seq BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, name)
);

-- 2) Bookings: public_id (human-friendly number)
ALTER TABLE IF EXISTS nextia_bookings
  ADD COLUMN IF NOT EXISTS public_id TEXT;

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_public_id
  ON nextia_bookings (client_id, public_id);

-- Optional uniqueness per client (only when present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nextia_bookings_client_public_id_uniq
  ON nextia_bookings (client_id, public_id)
  WHERE public_id IS NOT NULL;

-- 3) Preorders: public_id (human-friendly number)
ALTER TABLE IF EXISTS nextia_preorders
  ADD COLUMN IF NOT EXISTS public_id TEXT;

CREATE INDEX IF NOT EXISTS idx_nextia_preorders_client_public_id
  ON nextia_preorders (client_id, public_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nextia_preorders_client_public_id_uniq
  ON nextia_preorders (client_id, public_id)
  WHERE public_id IS NOT NULL;
