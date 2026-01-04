-- db/migrations/0004_appointments.sql
-- Services, professionals and appointments (scheduling)
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS nextia_services (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  duration_minutes INTEGER NOT NULL,
  base_price NUMERIC NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_services_client_id ON nextia_services(client_id);

CREATE TABLE IF NOT EXISTS nextia_professionals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_professionals_client_id ON nextia_professionals(client_id);

CREATE TABLE IF NOT EXISTS nextia_appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  contact_name TEXT NULL,
  service_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  professional_id TEXT NOT NULL,
  professional_name TEXT NOT NULL,
  start_dt TIMESTAMPTZ NOT NULL,
  end_dt TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  payment_timing TEXT NULL,
  payment_method TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_appointments_client_start ON nextia_appointments(client_id, start_dt DESC);
