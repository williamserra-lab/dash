-- db/migrations/20260121_0003_add_confirmation_fields_to_bookings.sql
-- Campos para confirmação do cliente (lead hours, lembrete e deadline).
-- Idempotente via IF NOT EXISTS.

ALTER TABLE nextia_bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS confirm_by_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS client_confirmed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_status ON nextia_bookings(client_id, status);
CREATE INDEX IF NOT EXISTS idx_nextia_bookings_confirm_by ON nextia_bookings(client_id, confirm_by_at);
