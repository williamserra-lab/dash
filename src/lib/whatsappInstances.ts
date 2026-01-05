// src/lib/whatsappInstances.ts
import { readJsonArray, writeJsonArray, getDataPath } from "@/lib/jsonStore";
import { createId } from "@/lib/id";
import { dbQuery } from "@/lib/db";

export type WhatsappProvider = "evolution";

export type WhatsappInstance = {
  id: string;
  clientId: string;
  provider: WhatsappProvider;
  label: string; // friendly name shown in UI
  instanceName: string; // evolution instance identifier
  baseUrl: string;
  apiKey: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

const JSON_FILE = getDataPath("whatsapp_instances.json");

function nowIso() {
  return new Date().toISOString();
}

async function dbEnabled(): Promise<boolean> {
  return Boolean((process.env.NEXTIA_DB_URL || "").trim());
}

function normalize(x: Partial<WhatsappInstance>): WhatsappInstance | null {
  const id = typeof x.id === "string" && x.id ? x.id : "";
  const clientId = typeof x.clientId === "string" && x.clientId ? x.clientId : "";
  const provider: WhatsappProvider = x.provider === "evolution" ? "evolution" : "evolution";
  const label = typeof x.label === "string" ? x.label.trim() : "";
  const instanceName = typeof x.instanceName === "string" ? x.instanceName.trim() : "";
  const baseUrl = typeof x.baseUrl === "string" ? x.baseUrl.trim() : "";
  const apiKey = typeof x.apiKey === "string" ? x.apiKey.trim() : "";
  const active = typeof x.active === "boolean" ? x.active : true;

  if (!id || !clientId || !label || !instanceName || !baseUrl || !apiKey) return null;

  return {
    id,
    clientId,
    provider,
    label,
    instanceName,
    baseUrl,
    apiKey,
    active,
    createdAt: typeof x.createdAt === "string" && x.createdAt ? x.createdAt : nowIso(),
    updatedAt: typeof x.updatedAt === "string" && x.updatedAt ? x.updatedAt : nowIso(),
  };
}

export async function listWhatsappInstancesByClient(clientId: string): Promise<WhatsappInstance[]> {
  if (await dbEnabled()) {
    const r = await dbQuery<WhatsappInstance>(
      `SELECT id, client_id as "clientId", provider, label, instance_name as "instanceName",
              base_url as "baseUrl", api_key as "apiKey", active,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM nextia_whatsapp_instances WHERE client_id=$1 ORDER BY created_at ASC`,
      [clientId]
    );
    return r.rows.map((x) => normalize(x)!).filter(Boolean);
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  return all
    .map((x) => normalize(x as any))
    .filter((x): x is WhatsappInstance => Boolean(x))
    .filter((x) => x.clientId === clientId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getWhatsappInstanceById(clientId: string, instanceId: string): Promise<WhatsappInstance | null> {
  if (await dbEnabled()) {
    const r = await dbQuery<WhatsappInstance>(
      `SELECT id, client_id as "clientId", provider, label, instance_name as "instanceName",
              base_url as "baseUrl", api_key as "apiKey", active,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM nextia_whatsapp_instances WHERE client_id=$1 AND id=$2 LIMIT 1`,
      [clientId, instanceId]
    );
    const row = r.rows[0];
    return row ? normalize(row) : null;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  const found = all.find((x) => (x as any).clientId === clientId && (x as any).id === instanceId);
  return found ? normalize(found as any) : null;
}

export async function getWhatsappInstanceByName(clientId: string, instanceName: string): Promise<WhatsappInstance | null> {
  const name = instanceName.trim();
  if (!name) return null;

  if (await dbEnabled()) {
    const r = await dbQuery<WhatsappInstance>(
      `SELECT id, client_id as "clientId", provider, label, instance_name as "instanceName",
              base_url as "baseUrl", api_key as "apiKey", active,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM nextia_whatsapp_instances WHERE client_id=$1 AND instance_name=$2 LIMIT 1`,
      [clientId, name]
    );
    const row = r.rows[0];
    return row ? normalize(row) : null;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  const found = all.find((x) => (x as any).clientId === clientId && String((x as any).instanceName) === name);
  return found ? normalize(found as any) : null;
}

export async function createWhatsappInstance(params: {
  clientId: string;
  label: string;
  instanceName: string;
  baseUrl: string;
  apiKey: string;
  provider?: WhatsappProvider;
  active?: boolean;
}): Promise<WhatsappInstance> {
  const createdAt = nowIso();
  const rec: WhatsappInstance = {
    id: createId("wi"),
    clientId: params.clientId,
    provider: "evolution",
    label: params.label.trim(),
    instanceName: params.instanceName.trim(),
    baseUrl: params.baseUrl.trim(),
    apiKey: params.apiKey.trim(),
    active: typeof params.active === "boolean" ? params.active : true,
    createdAt,
    updatedAt: createdAt,
  };

  if (await dbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_whatsapp_instances
       (id, client_id, provider, label, instance_name, base_url, api_key, active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rec.id, rec.clientId, rec.provider, rec.label, rec.instanceName, rec.baseUrl, rec.apiKey, rec.active, rec.createdAt, rec.updatedAt]
    );
    return rec;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  all.push(rec);
  await writeJsonArray(JSON_FILE, all);
  return rec;
}

export async function updateWhatsappInstance(clientId: string, instanceId: string, patch: Partial<Pick<WhatsappInstance,"label"|"instanceName"|"baseUrl"|"apiKey"|"active">>): Promise<WhatsappInstance | null> {
  const existing = await getWhatsappInstanceById(clientId, instanceId);
  if (!existing) return null;

  const updated: WhatsappInstance = {
    ...existing,
    label: typeof patch.label === "string" ? patch.label.trim() : existing.label,
    instanceName: typeof patch.instanceName === "string" ? patch.instanceName.trim() : existing.instanceName,
    baseUrl: typeof patch.baseUrl === "string" ? patch.baseUrl.trim() : existing.baseUrl,
    apiKey: typeof patch.apiKey === "string" ? patch.apiKey.trim() : existing.apiKey,
    active: typeof patch.active === "boolean" ? patch.active : existing.active,
    updatedAt: nowIso(),
  };

  if (await dbEnabled()) {
    await dbQuery(
      `UPDATE nextia_whatsapp_instances
       SET label=$1, instance_name=$2, base_url=$3, api_key=$4, active=$5, updated_at=$6
       WHERE client_id=$7 AND id=$8`,
      [updated.label, updated.instanceName, updated.baseUrl, updated.apiKey, updated.active, updated.updatedAt, clientId, instanceId]
    );
    return updated;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  const idx = all.findIndex((x) => (x as any).clientId === clientId && (x as any).id === instanceId);
  if (idx === -1) return null;
  (all as any)[idx] = updated;
  await writeJsonArray(JSON_FILE, all);
  return updated;
}

export async function deleteWhatsappInstance(clientId: string, instanceId: string): Promise<boolean> {
  if (await dbEnabled()) {
    const r = await dbQuery(`DELETE FROM nextia_whatsapp_instances WHERE client_id=$1 AND id=$2`, [clientId, instanceId]);
    return (r.rowCount || 0) > 0;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  const next = all.filter((x) => !((x as any).clientId === clientId && (x as any).id === instanceId));
  await writeJsonArray(JSON_FILE, next);
  return next.length != all.length;
}


export async function findClientIdByInstanceName(instanceName: string): Promise<string | null> {
  const name = instanceName.trim();
  if (!name) return null;

  if (await dbEnabled()) {
    const r = await dbQuery<{ clientId: string }>(
      `SELECT client_id as "clientId" FROM nextia_whatsapp_instances WHERE instance_name=$1 LIMIT 1`,
      [name]
    );
    return r.rows[0]?.clientId || null;
  }

  const all = await readJsonArray<WhatsappInstance>(JSON_FILE);
  const found = all.find((x) => String((x as any).instanceName || "").trim() === name);
  return found ? String((found as any).clientId || "") || null : null;
}
