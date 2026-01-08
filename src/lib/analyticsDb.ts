// src/lib/analyticsDb.ts
// Postgres adapter for analytics events.
// Used when NEXTIA_DB_URL is configured.
//
// Design goals:
// - Append-only
// - Query by clientId, time, type, correlationId
// - Safe: failures fall back to JSON store in analytics.ts

import { dbQuery } from "@/lib/db";

export type DbAnalyticsEventRow = {
  id: string;
  client_id: string;
  event_type: string;
  occurred_at: string; // ISO (from PG)
  correlation_id: string | null;
  entity_ref: string | null;
  actor: any | null;
  data: any | null;
};

export async function dbInsertAnalyticsEvent(input: {
  id: string;
  clientId: string;
  eventType: string;
  occurredAt: string; // ISO
  correlationId?: string | null;
  entityRef?: string | null;
  actor?: unknown;
  data?: unknown;
}): Promise<void> {
  await dbQuery(
    `
    INSERT INTO nextia_analytics_events
      (id, client_id, event_type, occurred_at, correlation_id, entity_ref, actor, data)
    VALUES
      ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb, $8::jsonb)
    ON CONFLICT (id) DO NOTHING;
    `,
    [
      input.id,
      input.clientId,
      input.eventType,
      input.occurredAt,
      input.correlationId ?? null,
      input.entityRef ?? null,
      JSON.stringify(input.actor ?? null),
      JSON.stringify(input.data ?? null),
    ]
  );
}

export async function dbListAnalyticsEventsByClient(params: {
  clientId: string;
  limit?: number;
  since?: string | null; // ISO
  until?: string | null; // ISO
  types?: string[] | null;
}): Promise<DbAnalyticsEventRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 5000, 20000));
  const sqlParts: string[] = [
    `SELECT id, client_id, event_type, occurred_at, correlation_id, entity_ref, actor, data`,
    `FROM nextia_analytics_events`,
    `WHERE client_id = $1`,
  ];
  const values: unknown[] = [params.clientId];
  let idx = 2;

  if (params.since) {
    sqlParts.push(`AND occurred_at >= $${idx}::timestamptz`);
    values.push(params.since);
    idx++;
  }
  if (params.until) {
    sqlParts.push(`AND occurred_at <= $${idx}::timestamptz`);
    values.push(params.until);
    idx++;
  }
  if (params.types && params.types.length > 0) {
    sqlParts.push(`AND event_type = ANY($${idx}::text[])`);
    values.push(params.types);
    idx++;
  }

  sqlParts.push(`ORDER BY occurred_at DESC`);
  sqlParts.push(`LIMIT ${limit}`);

  const r = await dbQuery<DbAnalyticsEventRow>(sqlParts.join("\n"), values);
  return r.rows ?? [];
}

export async function dbListAnalyticsEventsByCorrelation(params: {
  correlationId: string;
  clientId?: string | null;
  limit?: number;
}): Promise<DbAnalyticsEventRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 5000, 20000));

  const values: unknown[] = [params.correlationId];
  let where = `WHERE correlation_id = $1`;

  if (params.clientId) {
    values.push(params.clientId);
    where += ` AND client_id = $2`;
  }

  const r = await dbQuery<DbAnalyticsEventRow>(
    `
    SELECT id, client_id, event_type, occurred_at, correlation_id, entity_ref, actor, data
    FROM nextia_analytics_events
    ${where}
    ORDER BY occurred_at ASC
    LIMIT ${limit};
    `,
    values
  );
  return r.rows ?? [];
}

export async function dbListRecentCorrelations(params: {
  clientId?: string | null;
  limit?: number;
}): Promise<{ correlationId: string; clientId: string; lastSeenAt: string; count: number }[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const values: unknown[] = [];
  let where = `WHERE correlation_id IS NOT NULL AND correlation_id <> ''`;

  if (params.clientId) {
    values.push(params.clientId);
    where += ` AND client_id = $1`;
  }

  const r = await dbQuery<any>(
    `
    SELECT
      correlation_id as correlationId,
      client_id as clientId,
      MAX(occurred_at) as lastSeenAt,
      COUNT(*)::int as count
    FROM nextia_analytics_events
    ${where}
    GROUP BY correlation_id, client_id
    ORDER BY MAX(occurred_at) DESC
    LIMIT ${limit};
    `,
    values
  );
  return r.rows ?? [];
}
