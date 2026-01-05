// src/lib/preorders.ts
// Pré-pedidos (ponte entre bot e humano).
//
// Storage strategy:
// - When NEXTIA_DB_URL is set, persists in Postgres.
// - Otherwise, falls back to JSON store in /data.
//
// Contract notes (per continuity/chat):
// - Status includes: draft | awaiting_human_confirmation | confirmed | cancelled | expired
// - "expired" is automatically applied when expiresAt is reached and the preorder is still pending.

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";
import { createId } from "@/lib/id";
import { dbQuery, isDbEnabled } from "@/lib/db";

export type PreorderStatus =
  | "draft"
  | "awaiting_human_confirmation"
  | "confirmed"
  | "cancelled"
  | "expired";

export type PreorderItem = {
  productId: string;
  nameSnapshot: string;
  qty: number;
  unitPriceSnapshot: number;
  notes?: string | null;
};

export type PreorderDelivery = {
  mode: "pickup" | "delivery";
  fee: number;
  address?: string | null;
};

export type PreorderPayment = {
  mode: "cash" | "pix" | "card";
  pixQr?: string | null;
};

export type PreorderTotals = {
  subtotal: number;
  delivery: number;
  total: number;
};

export type Preorder = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string;

  items: PreorderItem[];
  delivery: PreorderDelivery;
  payment: PreorderPayment;

  totals: PreorderTotals;

  status: PreorderStatus;

  createdAt: string;
  updatedAt: string;
  updatedBy: "bot" | "human" | "system";

  // When reached and status is still pending (draft / awaiting_human_confirmation),
  // the preorder becomes "expired".
  expiresAt: string | null;
};


export type PreorderEventAction =
  | "created"
  | "updated"
  | "status_changed"
  | "expired";

export type PreorderEvent = {
  id: string;
  clientId: string;
  preorderId: string;
  ts: string;
  actor: string | null; // free-form identifier (e.g., "bot", "human:attendantId", "system")
  action: PreorderEventAction;
  reason: string | null;
  data: any | null;
};


export type CreatePreorderInput = {
  clientId: string;
  contactId: string;
  identifier: string;

  items?: unknown;
  delivery?: unknown;
  payment?: unknown;

  // Optional override; if omitted, derived from NEXTIA_PREORDER_EXPIRES_HOURS.
  expiresAt?: string | null;

  actor?: "bot" | "human" | "system";
};

export type UpdatePreorderPatch = {
  items?: unknown;
  delivery?: unknown;
  payment?: unknown;
  status?: PreorderStatus;
  expiresAt?: string | null;

  actor?: "bot" | "human" | "system";
  note?: string | null; // reserved (26.3 audit)
};

const JSON_FILE = "preorders.json";

function nowIso(): string {
  return new Date().toISOString();
}

function parseNumber(n: unknown, fallback = 0): number {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeActor(a: unknown): "bot" | "human" | "system" {
  return a === "bot" || a === "human" || a === "system" ? a : "system";
}

function normalizeStatus(s: unknown): PreorderStatus {
  return s === "draft" ||
    s === "awaiting_human_confirmation" ||
    s === "confirmed" ||
    s === "cancelled" ||
    s === "expired"
    ? s
    : "draft";
}

function normalizeItems(raw: unknown): PreorderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PreorderItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const productId = typeof o.productId === "string" ? o.productId.trim() : "";
    const nameSnapshot = typeof o.nameSnapshot === "string" ? o.nameSnapshot.trim() : "";
    const qty = parseNumber(o.qty, 0);
    const unitPriceSnapshot = parseNumber(o.unitPriceSnapshot, 0);
    if (!productId || !nameSnapshot) continue;
    if (qty <= 0) continue;
    out.push({
      productId,
      nameSnapshot,
      qty,
      unitPriceSnapshot,
      notes: typeof o.notes === "string" ? o.notes : null,
    });
  }
  return out;
}

function normalizeDelivery(raw: unknown): PreorderDelivery {
  const fallback: PreorderDelivery = { mode: "pickup", fee: 0, address: null };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "delivery" ? "delivery" : "pickup";
  const fee = parseNumber(o.fee, 0);
  const address =
    typeof o.address === "string" && o.address.trim() ? o.address.trim() : null;
  return { mode, fee: fee < 0 ? 0 : fee, address };
}

function normalizePayment(raw: unknown): PreorderPayment {
  const fallback: PreorderPayment = { mode: "cash", pixQr: null };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === "pix" || o.mode === "card" ? (o.mode as any) : "cash";
  const pixQr = typeof o.pixQr === "string" && o.pixQr.trim() ? o.pixQr.trim() : null;
  return { mode, pixQr };
}

function computeTotals(items: PreorderItem[], delivery: PreorderDelivery): PreorderTotals {
  const subtotal = items.reduce((acc, it) => acc + it.qty * it.unitPriceSnapshot, 0);
  const deliveryFee = delivery.mode === "delivery" ? parseNumber(delivery.fee, 0) : 0;
  const total = subtotal + deliveryFee;
  return {
    subtotal: Number(subtotal.toFixed(2)),
    delivery: Number(deliveryFee.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

function getExpiryHours(): number {
  const raw = process.env.NEXTIA_PREORDER_EXPIRES_HOURS;
  const hours = raw ? Number(raw) : 24;
  return Number.isFinite(hours) && hours > 0 ? hours : 24;
}

function defaultExpiresAt(): string {
  const hours = getExpiryHours();
  const ms = hours * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

function isPendingStatus(s: PreorderStatus): boolean {
  return s === "draft" || s === "awaiting_human_confirmation";
}

function coerceIsoOrNull(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function shouldExpire(pre: Preorder, now: Date): boolean {
  if (!isPendingStatus(pre.status)) return false;
  if (!pre.expiresAt) return false;
  const d = new Date(pre.expiresAt);
  if (!Number.isFinite(d.getTime())) return false;
  return d.getTime() <= now.getTime();
}



function eventsDataPath(clientId: string): string {
  return getDataPath(`preorder_events_${clientId}.json`);
}


function normalizeReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.trim();
  return r ? r : null;
}

async function dbEnsurePreorderEventsTable(): Promise<void> {
  // Schema is handled by migrations, but keep a guard for older DBs.
  await dbQuery(`
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
  `);

  await dbQuery(
    `CREATE INDEX IF NOT EXISTS nextia_preorder_events_client_preorder_idx
     ON nextia_preorder_events (client_id, preorder_id, ts DESC, id DESC)`
  );
}

async function writePreorderEvent(ev: PreorderEvent): Promise<void> {
  if (isDbEnabled()) {
    await dbEnsurePreorderEventsTable();
    await dbQuery(
      `
      INSERT INTO nextia_preorder_events
        (id, client_id, preorder_id, ts, actor, action, reason, data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      `,
      [
        ev.id,
        ev.clientId,
        ev.preorderId,
        ev.ts,
        ev.actor,
        ev.action,
        ev.reason,
        ev.data ? JSON.stringify(ev.data) : null,
      ]
    );
    return;
  }

  const path = eventsDataPath(ev.clientId);
  const arr = (await readJsonArray(path)) as any[];
  arr.push(ev);
  await writeJsonArray(path, arr);
}

export async function listPreorderEvents(clientId: string, preorderId: string): Promise<PreorderEvent[]> {
  if (isDbEnabled()) {
    await dbEnsurePreorderEventsTable();
    const res = await dbQuery(
      `
      SELECT id, client_id, preorder_id, ts, actor, action, reason, data
      FROM nextia_preorder_events
      WHERE client_id = $1 AND preorder_id = $2
      ORDER BY ts DESC, id DESC
      `,
      [clientId, preorderId]
    );
    return (res.rows as any[]).map((r) => ({
      id: r.id,
      clientId: r.client_id,
      preorderId: r.preorder_id,
      ts: new Date(r.ts).toISOString(),
      actor: r.actor ?? null,
      action: r.action,
      reason: r.reason ?? null,
      data: r.data ?? null,
    }));
  }

  const path = eventsDataPath(clientId);
  const arr = (await readJsonArray(path)) as any[];
  const out = arr
    .filter((e) => e && e.clientId === clientId && e.preorderId === preorderId)
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")));
  return out as PreorderEvent[];
}
async function writeAllJson(all: Preorder[]): Promise<void> {
  const path = getDataPath(JSON_FILE);
  await writeJsonArray(path, all);
}

async function readAllJson(): Promise<Preorder[]> {
  const path = getDataPath(JSON_FILE);
  const raw = await readJsonArray<any>(path);
  return raw
    .map((p) => normalizePreorder(p))
    .filter((p): p is Preorder => Boolean(p));
}

function normalizePreorder(p: any): Preorder | null {
  if (!p || typeof p !== "object") return null;

  const id = typeof p.id === "string" ? p.id : "";
  const clientId = typeof p.clientId === "string" ? p.clientId : "";
  const contactId = typeof p.contactId === "string" ? p.contactId : "";
  const identifier = typeof p.identifier === "string" ? p.identifier : "";

  if (!id || !clientId || !contactId || !identifier) return null;

  const items = normalizeItems(p.items);
  const delivery = normalizeDelivery(p.delivery);
  const payment = normalizePayment(p.payment);
  const totals = computeTotals(items, delivery);

  const createdAt = typeof p.createdAt === "string" && p.createdAt ? p.createdAt : nowIso();
  const updatedAt = typeof p.updatedAt === "string" && p.updatedAt ? p.updatedAt : nowIso();
  const updatedBy = normalizeActor(p.updatedBy);
  const status = normalizeStatus(p.status);

  const expiresAt =
    "expiresAt" in p ? coerceIsoOrNull(p.expiresAt) : coerceIsoOrNull(p.expires_at);

  return {
    id,
    clientId,
    contactId,
    identifier,
    items,
    delivery,
    payment,
    totals,
    status,
    createdAt,
    updatedAt,
    updatedBy,
    expiresAt: expiresAt ?? null,
  };
}

async function upsertDb(preorder: Preorder): Promise<void> {
  await dbQuery(
    `INSERT INTO nextia_preorders
      (id, client_id, contact_id, identifier, status, created_at, updated_at, expires_at, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id)
     DO UPDATE SET
       client_id = EXCLUDED.client_id,
       contact_id = EXCLUDED.contact_id,
       identifier = EXCLUDED.identifier,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at,
       payload = EXCLUDED.payload`,
    [
      preorder.id,
      preorder.clientId,
      preorder.contactId,
      preorder.identifier,
      preorder.status,
      preorder.createdAt,
      preorder.updatedAt,
      preorder.expiresAt,
      preorder,
    ]
  );
}

async function maybeExpireAndPersist(pre: Preorder): Promise<Preorder> {
  const now = new Date();
  if (!shouldExpire(pre, now)) return pre;

  const next: Preorder = {
    ...pre,
    status: "expired",
    updatedAt: nowIso(),
    updatedBy: "system",
  };

  if (isDbEnabled()) {
    await upsertDb(next);
    

return next;
  }

  const all = await readAllJson();
  const idx = all.findIndex((p) => p.clientId === next.clientId && p.id === next.id);
  if (idx >= 0) {
    all[idx] = next;
    await writeAllJson(all);
  }
  

return next;
}

export async function getPreordersByClient(
  clientId: string,
  status: PreorderStatus | null = null
): Promise<Preorder[]> {
  if (!clientId) return [];

  if (isDbEnabled()) {
    const params: any[] = [clientId];
    let where = "client_id = $1";
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    const r = await dbQuery<{ payload: any }>(
      `SELECT payload
       FROM nextia_preorders
       WHERE ${where}
       ORDER BY updated_at DESC`,
      params
    );

    const out: Preorder[] = [];
    for (const row of r.rows || []) {
      const p = normalizePreorder(row.payload);
      if (!p) continue;
      out.push(await maybeExpireAndPersist(p));
    }
    return out;
  }

  const all = await readAllJson();
  const filtered = all
    .filter((p) => p.clientId === clientId && (!status || p.status === status))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const out: Preorder[] = [];
  for (const p of filtered) out.push(await maybeExpireAndPersist(p));
  return out;
}

export async function getPreorderById(clientId: string, preorderId: string): Promise<Preorder | null> {
  if (!clientId || !preorderId) return null;

  if (isDbEnabled()) {
    const r = await dbQuery<{ payload: any }>(
      `SELECT payload
       FROM nextia_preorders
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [clientId, preorderId]
    );
    const row = r.rows?.[0];
    if (!row) return null;
    const p = normalizePreorder(row.payload);
    return p ? await maybeExpireAndPersist(p) : null;
  }

  const all = await readAllJson();
  const found = all.find((p) => p.clientId === clientId && p.id === preorderId) || null;
  return found ? await maybeExpireAndPersist(found) : null;
}

export async function createPreorder(input: CreatePreorderInput): Promise<Preorder> {
  const actor = normalizeActor(input.actor);
  const createdAt = nowIso();

  const items = normalizeItems(input.items);
  const delivery = normalizeDelivery(input.delivery);
  const payment = normalizePayment(input.payment);
  const totals = computeTotals(items, delivery);

  const expiresAt =
    "expiresAt" in input ? (input.expiresAt === null ? null : coerceIsoOrNull(input.expiresAt) ?? null) : defaultExpiresAt();

  const preorder: Preorder = {
    id: createId("preorder"),
    clientId: input.clientId,
    contactId: input.contactId,
    identifier: input.identifier,

    items,
    delivery,
    payment,
    totals,

    status: "draft",

    createdAt,
    updatedAt: createdAt,
    updatedBy: actor,

    expiresAt: expiresAt ?? null,
  };

  if (isDbEnabled()) {
    await upsertDb(preorder);
    
try {
  await writePreorderEvent({
    id: createId("porev"),
    clientId: preorder.clientId,
    preorderId: preorder.id,
    ts: new Date().toISOString(),
    actor: actor ?? preorder.updatedBy,
    action: "created",
    reason: null,
    data: { status: preorder.status, expiresAt: preorder.expiresAt },
  });
} catch {
  // best-effort
}

return preorder;
  }

  const all = await readAllJson();
  all.push(preorder);
  await writeAllJson(all);
  return preorder;
}

export async function updatePreorder(
  clientId: string,
  preorderId: string,
  patch: UpdatePreorderPatch
): Promise<Preorder | null> {
  const existing = await getPreorderById(clientId, preorderId);
  if (!existing) return null;

  const actor = normalizeActor(patch.actor);
  const updatedAt = nowIso();

  const next: Preorder = {
    ...existing,
    updatedAt,
    updatedBy: actor,
  };

  if ("items" in patch) next.items = normalizeItems(patch.items);
  if ("delivery" in patch) next.delivery = normalizeDelivery(patch.delivery);
  if ("payment" in patch) next.payment = normalizePayment(patch.payment);
  if ("status" in patch && patch.status) next.status = patch.status;
  if ("expiresAt" in patch) next.expiresAt = coerceIsoOrNull(patch.expiresAt);

  next.totals = computeTotals(next.items, next.delivery);

  // If status is terminal, expiresAt no longer matters; keep it for audit/trace.

  if (isDbEnabled()) {
    await upsertDb(next);
    


try {
  await writePreorderEvent({
    id: createId("porev"),
    clientId,
    preorderId,
    ts: new Date().toISOString(),
    actor: actor ?? next.updatedBy,
    action: "updated",
    reason: normalizeReason(patch.note),
    data: { fields: Object.keys(patch || {}).filter((k) => k !== "actor" && k !== "note") },
  });
} catch {
  // best-effort
}

return next;
  }

  const all = await readAllJson();
  const idx = all.findIndex((p) => p.clientId === clientId && p.id === preorderId);
  if (idx < 0) return null;
  all[idx] = next;
  await writeAllJson(all);
  

return next;
}

export async function setPreorderStatus(
  clientId: string,
  preorderId: string,
  status: PreorderStatus,
  actor: "bot" | "human" | "system" = "system",
  note: string | null = null
): Promise<Preorder | null> {
  // note is reserved for 26.3 audit events
  return await updatePreorder(clientId, preorderId, { status, actor, note });
}
