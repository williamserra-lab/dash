-- db/migrations/20260121_0001_add_attendant_id_to_bookings.sql
-- Add attendant_id to nextia_bookings (profissional responsável pelo horário).
-- Idempotent via IF NOT EXISTS.

ALTER TABLE nextia_bookings
  ADD COLUMN IF NOT EXISTS attendant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_attendant_id
  ON nextia_bookings(attendant_id);

-- Ajuda para buscar conflitos rapidamente
CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_attendant_time
  ON nextia_bookings(client_id, attendant_id, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_contact_time
  ON nextia_bookings(client_id, contact_id, start_at, end_at);
