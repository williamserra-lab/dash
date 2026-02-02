-- Timeline events (PASSO 5)

CREATE TABLE IF NOT EXISTS nextia_timeline_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- order | booking
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  status_group TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nextia_timeline_events_lookup
  ON nextia_timeline_events (client_id, entity_type, entity_id, at);
