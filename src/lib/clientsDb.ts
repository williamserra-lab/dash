// src/lib/clientsDb.ts
export const runtime = "nodejs";

import { dbQuery, ensureDbSchema } from "@/lib/db";

// Ensure json/jsonb params are valid JSON strings
function jsonParam(value: any): any {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    // Fallback to string, will error with clearer message downstream
    return String(value);
  }
}


export type DbClientRow = {
  id: string;
  name: string;
  status: string;
  segment: string | null;
  created_at: string;
  updated_at: string;
  whatsapp_numbers: any | null;
  billing: any | null;
  access: any | null;
  plan: any | null;
  profile: any | null;
};

let __clientsSchemaInit: Promise<void> | null = null;

export async function ensureClientsSchema(): Promise<void> {
  // Schema is managed by db migrations (db/migrations/*.sql).
  // Keep this wrapper for backward compatibility.
  return ensureDbSchema();
}

export async function dbListClients(): Promise<DbClientRow[]> {
  await ensureClientsSchema();
  const res = await dbQuery(
    `SELECT * FROM nextia_clients ORDER BY updated_at DESC, id ASC`
  );
  return res.rows as any;
}

export async function dbGetClientById(id: string): Promise<DbClientRow | null> {
  await ensureClientsSchema();
  const res = await dbQuery(`SELECT * FROM nextia_clients WHERE id = $1`, [id]);
  return (res.rows?.[0] as any) || null;
}

export async function dbInsertClient(
  row: Omit<DbClientRow, "created_at" | "updated_at"> & {
    created_at: string;
    updated_at: string;
  },
  actor: string
): Promise<void> {
  await ensureClientsSchema();

  await dbQuery(
    `
    INSERT INTO nextia_clients (
      id, name, status, segment, created_at, updated_at,
      whatsapp_numbers, billing, access, plan, profile
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb)
    `,
    [
      row.id,
      row.name,
      row.status,
      row.segment,
      row.created_at,
      row.updated_at,
      jsonParam(row.whatsapp_numbers),
      jsonParam(row.billing),
      jsonParam(row.access),
      jsonParam(row.plan),
      jsonParam(row.profile),
    ]
  );

  await dbQuery(
    `INSERT INTO nextia_client_audit (client_id, actor, action, snapshot)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [row.id, actor, "create", jsonParam(row)]
  );
}

export async function dbUpdateClient(
  id: string,
  patch: Partial<DbClientRow>,
  actor: string
): Promise<DbClientRow | null> {
  await ensureClientsSchema();

  const current = await dbGetClientById(id);
  if (!current) return null;

  const next: DbClientRow = {
    ...current,
    ...patch,
    id: current.id,
    created_at: current.created_at,
    updated_at: new Date().toISOString(),
  };

  await dbQuery(
    `
    UPDATE nextia_clients SET
      name=$2,
      status=$3,
      segment=$4,
      updated_at=$5,
      whatsapp_numbers=$6,
      billing=$7,
      access=$8,
      plan=$9,
      profile=$10
    WHERE id=$1
    `,
    [
      id,
      next.name,
      next.status,
      next.segment,
      next.updated_at,
      jsonParam(next.whatsapp_numbers),
      jsonParam(next.billing),
      jsonParam(next.access),
      jsonParam(next.plan),
      jsonParam(next.profile),
    ]
  );

  await dbQuery(
    `INSERT INTO nextia_client_audit (client_id, actor, action, diff, snapshot)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
    [id, actor, "update", jsonParam(patch), jsonParam(next)]
  );

  return next;
}


export async function dbDeleteClientById(id: string, _actor: string): Promise<boolean> {
  await ensureClientsSchema();

  const res = await dbQuery(
    `
    DELETE FROM clients
    WHERE id=$1
    `,
    [id]
  );

  // dbQuery may not return affectedRows; rely on a follow-up lookup
  const remaining = await dbGetClientById(id);
  return !remaining;
}

