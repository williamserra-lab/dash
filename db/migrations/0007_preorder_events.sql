-- db/migrations/0007_preorder_events.sql
-- Preorder audit events (idempotent)

CREATE TABLE IF NOT EXISTS nextia_preorder_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  preorder_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  actor TEXT NULL,
  action TEXT NOT NULL,
  reason TEXT NULL,
  data JSONB NULL
);

CREATE INDEX IF NOT EXISTS nextia_preorder_events_client_preorder_idx
ON nextia_preorder_events (client_id, preorder_id, ts DESC, id DESC);
