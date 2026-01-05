-- db/migrations/0008_bookings.sql
-- Booking + ServiceCalendarConfig (contract per continuity/chat).
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS nextia_service_calendar_config (
  client_id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nextia_bookings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  service JSONB NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  collected JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_id ON nextia_bookings(client_id);
CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_status ON nextia_bookings(client_id, status);
CREATE INDEX IF NOT EXISTS idx_nextia_bookings_client_start_at ON nextia_bookings(client_id, start_at);
