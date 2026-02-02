-- db/migrations/20260122_0001_add_no_show_fields_to_bookings.sql
-- Adiciona campos de auditoria para no-show (manual/automático)

ALTER TABLE IF EXISTS nextia_bookings
  ADD COLUMN IF NOT EXISTS no_show_marked_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS no_show_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_no_show_marked_at
  ON nextia_bookings (client_id, no_show_marked_at);
