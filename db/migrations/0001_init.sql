-- db/migrations/0001_init.sql
-- Initial schema for NextIA (PostgreSQL).
-- This migration is idempotent (uses IF NOT EXISTS).

-- Clients (tenants)
CREATE TABLE IF NOT EXISTS nextia_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  segment TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  whatsapp_numbers JSONB NULL,
  billing JSONB NULL,
  access JSONB NULL,
  plan JSONB NULL,
  profile JSONB NULL
);

-- Unique email (case-insensitive) if present
CREATE UNIQUE INDEX IF NOT EXISTS nextia_clients_email_uq
ON nextia_clients (LOWER((profile->>'emailPrincipal')))
WHERE profile ? 'emailPrincipal';

-- Unique documento if present (already normalized by app to digits-only where appropriate)
CREATE UNIQUE INDEX IF NOT EXISTS nextia_clients_documento_uq
ON nextia_clients ((profile->>'documento'))
WHERE profile ? 'documento';

CREATE INDEX IF NOT EXISTS nextia_clients_status_idx
ON nextia_clients (status);

CREATE INDEX IF NOT EXISTS nextia_clients_updated_at_idx
ON nextia_clients (updated_at);

-- Client audit trail
CREATE TABLE IF NOT EXISTS nextia_client_audit (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  diff JSONB NULL,
  snapshot JSONB NULL
);

CREATE INDEX IF NOT EXISTS nextia_client_audit_client_ts_idx
ON nextia_client_audit (client_id, ts DESC);

-- Messages (WhatsApp in/out, for audit and chat UI)
CREATE TABLE IF NOT EXISTS nextia_messages (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  instance TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  key_id TEXT NOT NULL,
  from_me BOOLEAN NOT NULL,
  message_ts BIGINT NULL,
  text TEXT NULL,
  raw JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, instance, key_id)
);

CREATE INDEX IF NOT EXISTS nextia_messages_remote_idx
ON nextia_messages (client_id, instance, remote_jid, message_ts);

-- Conversation state (deterministic engine storage)
CREATE TABLE IF NOT EXISTS nextia_conversation_state (
  client_id TEXT NOT NULL,
  instance TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, instance, remote_jid)
);

-- Outbox queue (deterministic + UI/handoff sends)
CREATE TABLE IF NOT EXISTS nextia_outbox (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  client_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  "to" TEXT NOT NULL,
  message TEXT NOT NULL,
  not_before TIMESTAMPTZ NULL,
  contact_id TEXT NULL,
  order_id TEXT NULL,
  message_type TEXT NULL,
  idempotency_key TEXT NULL,
  context JSONB NULL,
  provider JSONB NULL
);

CREATE INDEX IF NOT EXISTS nextia_outbox_status_idx
ON nextia_outbox (status, not_before, created_at);

-- Conversation events (audit + reconciliation)
CREATE TABLE IF NOT EXISTS nextia_conversation_events (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_id TEXT NOT NULL,
  instance TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NULL,
  reason_code TEXT NULL,
  payload JSONB NULL,
  meta JSONB NULL
);

CREATE INDEX IF NOT EXISTS nextia_conversation_events_idx
ON nextia_conversation_events (client_id, instance, remote_jid, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS nextia_conversation_events_dedupe_idx
ON nextia_conversation_events (client_id, instance, remote_jid, event_type, dedupe_key)
WHERE dedupe_key IS NOT NULL;

-- Admin files (internal tools)
CREATE TABLE IF NOT EXISTS nextia_files (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  summary TEXT NULL,
  summary_meta JSONB NULL,
  summary_updated_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS nextia_files_created_idx
ON nextia_files (created_at DESC);
