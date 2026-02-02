// src/lib/attendants.ts
import { readJsonArray, writeJsonArray, getDataPath } from "@/lib/jsonStore";
import { createId } from "@/lib/id";
import { dbQuery } from "@/lib/db";

export type AttendantRole = "admin" | "agent";

export type Attendant = {
  id: string;
  clientId: string;
  name: string;
  specialty?: string | null;
  role: AttendantRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const JSON_FILE = getDataPath("attendants.json");

function nowIso() {
  return new Date().toISOString();
}

function normalize(a: Partial<Attendant>): Attendant | null {
  const id = typeof a.id === "string" && a.id ? a.id : "";
  const clientId = typeof a.clientId === "string" && a.clientId ? a.clientId : "";
  const name = typeof a.name === "string" ? a.name.trim() : "";
  const specialtyRaw = typeof (a as any).specialty === "string" ? String((a as any).specialty).trim() : "";
  const specialty = specialtyRaw ? specialtyRaw : null;
  const role: AttendantRole = a.role === "agent" ? "agent" : "admin";
  const active = typeof a.active === "boolean" ? a.active : true;

  if (!id || !clientId || !name) return null;

  return {
    id,
    clientId,
    name,
    role,
    active,
    createdAt: typeof a.createdAt === "string" && a.createdAt ? a.createdAt : nowIso(),
    updatedAt: typeof a.updatedAt === "string" && a.updatedAt ? a.updatedAt : nowIso(),
  };
}

async function dbEnabled(): Promise<boolean> {
  return Boolean((process.env.NEXTIA_DB_URL || "").trim());
}

export async function listAttendantsByClient(clientId: string): Promise<Attendant[]> {
  if (await dbEnabled()) {
    const r = await dbQuery<Attendant>(
      `SELECT id, client_id as "clientId", name, specialty, role, active, created_at as "createdAt", updated_at as "updatedAt"
       FROM nextia_attendants WHERE client_id=$1 ORDER BY created_at ASC`,
      [clientId]
    );
    return r.rows.map((x) => normalize(x)!).filter(Boolean);
  }

  const all = await readJsonArray<Attendant>(JSON_FILE);
  return all
    .map((x) => normalize(x as any))
    .filter((x): x is Attendant => Boolean(x))
    .filter((x) => x.clientId === clientId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getAttendantById(clientId: string, attendantId: string): Promise<Attendant | null> {
  if (await dbEnabled()) {
    const r = await dbQuery<Attendant>(
      `SELECT id, client_id as "clientId", name, specialty, role, active, created_at as "createdAt", updated_at as "updatedAt"
       FROM nextia_attendants WHERE client_id=$1 AND id=$2 LIMIT 1`,
      [clientId, attendantId]
    );
    const row = r.rows[0];
    return row ? normalize(row) : null;
  }

  const all = await readJsonArray<Attendant>(JSON_FILE);
  const found = all.find((x) => (x as any).clientId === clientId && (x as any).id === attendantId);
  return found ? normalize(found as any) : null;
}

export async function createAttendant(params: {
  clientId: string;
  name: string;
  specialty?: string | null;
  role?: AttendantRole;
  active?: boolean;
}): Promise<Attendant> {
  const createdAt = nowIso();
  const rec: Attendant = {
    id: createId("at"),
    clientId: params.clientId,
    name: params.name.trim(),
    specialty: params.specialty ?? null,
    role: params.role === "agent" ? "agent" : "admin",
    active: typeof params.active === "boolean" ? params.active : true,
    createdAt,
    updatedAt: createdAt,
  };

  if (await dbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_attendants (id, client_id, name, specialty, role, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rec.id, rec.clientId, rec.name, rec.specialty, rec.role, rec.active, rec.createdAt, rec.updatedAt]
    );
    return rec;
  }

  const all = await readJsonArray<Attendant>(JSON_FILE);
  all.push(rec);
  await writeJsonArray(JSON_FILE, all);
  return rec;
}

export async function updateAttendant(clientId: string, attendantId: string, patch: Partial<Pick<Attendant, "name"|"specialty"|"role"|"active">>): Promise<Attendant | null> {
  const existing = await getAttendantById(clientId, attendantId);
  if (!existing) return null;

  const updated: Attendant = {
    ...existing,
    name: typeof patch.name === "string" ? patch.name.trim() : existing.name,
    role: patch.role === "agent" ? "agent" : patch.role === "admin" ? "admin" : existing.role,
    active: typeof patch.active === "boolean" ? patch.active : existing.active,
    updatedAt: nowIso(),
  };

  if (await dbEnabled()) {
    await dbQuery(
      `UPDATE nextia_attendants SET name=$1, role=$2, active=$3, updated_at=$4 WHERE client_id=$5 AND id=$6`,
      [updated.name, updated.role, updated.active, updated.updatedAt, clientId, attendantId]
    );
    return updated;
  }

  const all = await readJsonArray<Attendant>(JSON_FILE);
  const idx = all.findIndex((x) => (x as any).clientId === clientId && (x as any).id === attendantId);
  if (idx === -1) return null;
  (all as any)[idx] = updated;
  await writeJsonArray(JSON_FILE, all);
  return updated;
}

export async function deleteAttendant(clientId: string, attendantId: string): Promise<boolean> {
  if (await dbEnabled()) {
    const r = await dbQuery(`DELETE FROM nextia_attendants WHERE client_id=$1 AND id=$2`, [clientId, attendantId]);
    return (r.rowCount || 0) > 0;
  }

  const all = await readJsonArray<Attendant>(JSON_FILE);
  const next = all.filter((x) => !((x as any).clientId === clientId && (x as any).id === attendantId));
  await writeJsonArray(JSON_FILE, next);
  return next.length !== all.length;
}
