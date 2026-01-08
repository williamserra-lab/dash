-- db/migrations/0010_analytics_events.sql
-- Analytics foundation: global events table
-- Primary: Postgres. JSON remains as fallback store.
-- Idempotent migration.

CREATE TABLE IF NOT EXISTS nextia_analytics_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  correlation_id TEXT NULL,
  entity_ref TEXT NULL,
  actor JSONB NULL,
  data JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_analytics_events_client_time
  ON nextia_analytics_events (client_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_nextia_analytics_events_type_time
  ON nextia_analytics_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_nextia_analytics_events_correlation
  ON nextia_analytics_events (correlation_id);

CREATE INDEX IF NOT EXISTS idx_nextia_analytics_events_entity_ref
  ON nextia_analytics_events (entity_ref);
