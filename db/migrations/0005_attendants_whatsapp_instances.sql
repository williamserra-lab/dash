-- db/migrations/0005_attendants_whatsapp_instances.sql

CREATE TABLE IF NOT EXISTS nextia_attendants (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nextia_attendants_client_id_idx ON nextia_attendants (client_id);

CREATE TABLE IF NOT EXISTS nextia_whatsapp_instances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'evolution',
  label TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS nextia_whatsapp_instances_client_id_idx ON nextia_whatsapp_instances (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS nextia_whatsapp_instances_unique_name_per_client ON nextia_whatsapp_instances (client_id, instance_name);
