// src/lib/db.ts
// Postgres adapter (runtime data): messages, outbox, conversation state, events.
// Enabled when NEXTIA_DB_URL is set.
// NOTE: Requires dependency "pg" (npm i pg).

import { applyMigrations } from "@/lib/migrations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pool = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QueryResult<T = AnyRecord> = { rows: T[]; rowCount?: number };

declare global {
  // eslint-disable-next-line no-var
  var __nextiaPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __nextiaPgInit: Promise<void> | undefined;
}

function getDbUrl(): string {
  return (process.env.NEXTIA_DB_URL || "").trim();
}

export function isDbEnabled(): boolean {
  return Boolean(getDbUrl());
}

async function getPool(): Promise<Pool> {
  if (!isDbEnabled()) {
    throw new Error("DB not enabled (NEXTIA_DB_URL missing).");
  }

  if (global.__nextiaPgPool) return global.__nextiaPgPool;

  // Dynamic import to avoid hard crash when DB is disabled.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pg = require("pg") as { Pool: new (cfg: AnyRecord) => Pool };

  const pool = new pg.Pool({
    connectionString: getDbUrl(),
    max: Number(process.env.NEXTIA_DB_POOL_MAX || "10"),
  });

  global.__nextiaPgPool = pool;
  return pool;
}

export async function ensureDbSchema(): Promise<void> {
  if (!isDbEnabled()) return;

  if (global.__nextiaPgInit) return global.__nextiaPgInit;

  global.__nextiaPgInit = (async () => {
    const pool = await getPool();
    await applyMigrations(pool);
  })();

  return global.__nextiaPgInit;
}

export async function dbQuery<T = AnyRecord>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  await ensureDbSchema();
  const pool = await getPool();

  // Pool is typed as any to allow DB to be optional.
  // TS forbids generic type arguments on untyped calls.
  // We keep the typed return contract by casting the result.
  return (await pool.query(sql, params)) as QueryResult<T>;
}
