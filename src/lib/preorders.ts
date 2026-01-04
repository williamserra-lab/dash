// src/lib/preorders.ts
// Pré-pedidos (ponte entre bot e humano).
//
// Storage strategy:
// - When NEXTIA_DB_URL is set, persists in Postgres.
// - Otherwise, falls back to JSON store in /data.

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";
import { dbQuery, isDbEnabled } from "@/lib/db";

export type PreorderStatus =
  | "draft"
  | "awaiting_human_confirmation"
  | "confirmed"
  | "cancelled";

export type PreorderItem = {
  productId?: string | null;
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
  mode: "cash" | "pix" | "card" | "unknown";
  pixQr?: string | null;
};

export type PreorderTotals = {
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type PreorderAuditEntry = {
  ts: string;
  actor: "bot" | "human" | "system";
  action:
    | "create"
    | "update"
    | "set_status"
    | "add_item"
    | "remove_item"
    | "change_delivery"
    | "change_payment";
  note?: string | null;
};

export type Preorder = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string;
  contactName?: string | null;

  status: PreorderStatus;
  items: PreorderItem[];
  delivery: PreorderDelivery;
  payment: PreorderPayment;
  totals: PreorderTotals;

  createdAt: string;
  updatedAt: string;
  updatedBy: "bot" | "human" | "system";
  audit: PreorderAuditEntry[];

  // Optional correlation to the WhatsApp conversation
  instance?: string | null;
  remoteJid?: string | null;
};

export type CreatePreorderInput = {
  clientId: string;
  contactId: string;
  identifier: string;
  contactName?: string | null;
  items?: unknown;
  delivery?: unknown;
  payment?: unknown;
  instance?: string | null;
  remoteJid?: string | null;
  actor?: "bot" | "human" | "system";
};

export type UpdatePreorderPatch = {
  items?: unknown;
  delivery?: unknown;
  payment?: unknown;
  status?: unknown;
  actor?: "bot" | "human" | "system";
  note?: string | null;
};

export type PreorderListFilters = {
  status?: PreorderStatus | null;
  contactId?: string | null;
  identifier?: string | null;
  limit?: number | null;
};

const FILE = getDataPath("preorders.json");

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : String(v || "");
}

function clampMoney(n: unknown): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.round(x * 100) / 100);
}

function clampInt(n: unknown, min = 0, max = 10_000): number {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function normalizeItems(raw: unknown): PreorderItem[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: PreorderItem[] = [];

  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const name = asStr(o.nameSnapshot || o.name || "").trim();
    if (!name) continue;

    const qty = clampInt(o.qty ?? 1, 1, 999);
    const unit = clampMoney(o.unitPriceSnapshot ?? o.unitPrice ?? o.price ?? 0);

    out.push({
      productId: o.productId ? asStr(o.productId).trim() : null,
      nameSnapshot: name,
      qty,
      unitPriceSnapshot: unit,
      notes: typeof o.notes === "string" ? o.notes : null,
    });
  }

  return out;
}

function normalizeDelivery(raw: unknown): PreorderDelivery {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const modeRaw = asStr(o.mode || "delivery").trim().toLowerCase();
  const mode: "pickup" | "delivery" = modeRaw === "pickup" ? "pickup" : "delivery";

  return {
    mode,
    fee: clampMoney(o.fee ?? o.deliveryFee ?? 0),
    address: typeof o.address === "string" ? o.address : null,
  };
}

function normalizePayment(raw: unknown): PreorderPayment {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const modeRaw = asStr(o.mode || "unknown").trim().toLowerCase();
  const mode: PreorderPayment["mode"] =
    modeRaw === "pix" ? "pix" : modeRaw === "cash" ? "cash" : modeRaw === "card" ? "card" : "unknown";

  return {
    mode,
    pixQr: typeof o.pixQr === "string" ? o.pixQr : null,
  };
}

function calcTotals(items: PreorderItem[], delivery: PreorderDelivery): PreorderTotals {
  const subtotal = clampMoney(
    items.reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.unitPriceSnapshot || 0), 0)
  );
  const deliveryFee = clampMoney(delivery.fee);
  const total = clampMoney(subtotal + deliveryFee);
  return { subtotal, deliveryFee, total };
}

function normalizeStatus(raw: unknown): PreorderStatus {
  const s = asStr(raw).trim().toLowerCase();
  if (s === "draft") return "draft";
  if (s === "awaiting_human_confirmation") return "awaiting_human_confirmation";
  if (s === "confirmed") return "confirmed";
  if (s === "cancelled") return "cancelled";
  return "draft";
}

function normalizeActor(raw: unknown): "bot" | "human" | "system" {
  const s = asStr(raw).trim().toLowerCase();
  if (s === "bot") return "bot";
  if (s === "human") return "human";
  return "system";
}

function normalizePreorder(raw: unknown): Preorder | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const id = asStr(o.id).trim();
  const clientId = asStr(o.clientId).trim();
  const contactId = asStr(o.contactId).trim();
  const identifier = asStr(o.identifier).trim();

  if (!id || !clientId || !contactId || !identifier) return null;

  const items = normalizeItems(o.items);
  const delivery = normalizeDelivery(o.delivery);
  const payment = normalizePayment(o.payment);
  const totals = calcTotals(items, delivery);

  const createdAt = asStr(o.createdAt || nowIso());
  const updatedAt = asStr(o.updatedAt || createdAt);

  const status = normalizeStatus(o.status);
  const updatedBy = normalizeActor(o.updatedBy);

  const auditRaw = Array.isArray(o.audit) ? o.audit : [];
  const audit: PreorderAuditEntry[] = auditRaw
    .map((e) => {
      if (!e || typeof e !== "object") return null;
      const x = e as Record<string, unknown>;
      const ts = asStr(x.ts || "").trim() || nowIso();
      const actor = normalizeActor(x.actor);
      const action = asStr(x.action || "update").trim();
      const note = typeof x.note === "string" ? x.note : null;
      return {
        ts,
        actor,
        action: (action as PreorderAuditEntry["action"]) || "update",
        note,
      };
    })
    .filter(Boolean) as PreorderAuditEntry[];

  return {
    id,
    clientId,
    contactId,
    identifier,
    contactName: typeof o.contactName === "string" ? o.contactName : null,
    status,
    items,
    delivery,
    payment,
    totals,
    createdAt,
    updatedAt,
    updatedBy,
    audit,
    instance: typeof o.instance === "string" ? o.instance : null,
    remoteJid: typeof o.remoteJid === "string" ? o.remoteJid : null,
  };
}

async function readAllJson(): Promise<Preorder[]> {
  const raw = await readJsonArray<unknown>(FILE);
  const out: Preorder[] = [];
  for (const entry of raw) {
    const p = normalizePreorder(entry);
    if (p) out.push(p);
  }
  return out;
}

async function writeAllJson(all: Preorder[]): Promise<void> {
  await writeJsonArray(FILE, all);
}

async function listDb(clientId: string, filters: PreorderListFilters): Promise<Preorder[]> {
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.min(500, Math.floor(filters.limit))
      : 100;

  const where: string[] = ["client_id = $1"];
  const params: unknown[] = [clientId];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.contactId) {
    params.push(String(filters.contactId));
    where.push(`contact_id = $${params.length}`);
  }
  if (filters.identifier) {
    params.push(String(filters.identifier));
    where.push(`identifier = $${params.length}`);
  }

  params.push(limit);

  const res = await dbQuery<{
    id: string;
    payload: unknown;
  }>(
    `SELECT id, payload
     FROM nextia_preorders
     WHERE ${where.join(" AND ")}
     ORDER BY updated_at DESC
     LIMIT $${params.length};`,
    params
  );

  const out: Preorder[] = [];
  for (const row of res.rows || []) {
    const p = normalizePreorder(row.payload);
    if (p) out.push(p);
  }
  return out;
}

async function getByIdDb(clientId: string, preorderId: string): Promise<Preorder | null> {
  const res = await dbQuery<{ payload: unknown }>(
    `SELECT payload
     FROM nextia_preorders
     WHERE client_id = $1 AND id = $2
     LIMIT 1;`,
    [clientId, preorderId]
  );

  const row = res.rows?.[0];
  if (!row) return null;
  return normalizePreorder(row.payload);
}

async function upsertDb(p: Preorder): Promise<void> {
  await dbQuery(
    `INSERT INTO nextia_preorders
      (id, client_id, contact_id, identifier, status, updated_at, created_at, payload)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      contact_id = EXCLUDED.contact_id,
      identifier = EXCLUDED.identifier,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at,
      payload = EXCLUDED.payload;`,
    [
      p.id,
      p.clientId,
      p.contactId,
      p.identifier,
      p.status,
      p.updatedAt,
      p.createdAt,
      p,
    ]
  );
}

export async function getPreordersByClient(
  clientId: string,
  filters: PreorderListFilters = {}
): Promise<Preorder[]> {
  if (isDbEnabled()) {
    return await listDb(clientId, filters);
  }

  const all = await readAllJson();
  const status = filters.status || null;
  const contactId = filters.contactId ? String(filters.contactId) : null;
  const identifier = filters.identifier ? String(filters.identifier) : null;
  const limit =
    typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.min(500, Math.floor(filters.limit))
      : 100;

  return all
    .filter((p) => p.clientId === clientId)
    .filter((p) => (status ? p.status === status : true))
    .filter((p) => (contactId ? p.contactId === contactId : true))
    .filter((p) => (identifier ? p.identifier === identifier : true))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

export async function getPreorderById(
  clientId: string,
  preorderId: string
): Promise<Preorder | null> {
  if (isDbEnabled()) {
    return await getByIdDb(clientId, preorderId);
  }

  const all = await readAllJson();
  return all.find((p) => p.clientId === clientId && p.id === preorderId) || null;
}

export async function createPreorder(input: CreatePreorderInput): Promise<Preorder> {
  const actor = normalizeActor(input.actor);
  const createdAt = nowIso();

  const items = normalizeItems(input.items);
  const delivery = normalizeDelivery(input.delivery);
  const payment = normalizePayment(input.payment);
  const totals = calcTotals(items, delivery);

  const p: Preorder = {
    id: createId("po"),
    clientId: String(input.clientId || "").trim(),
    contactId: String(input.contactId || "").trim(),
    identifier: String(input.identifier || "").trim(),
    contactName: typeof input.contactName === "string" ? input.contactName : null,
    status: "draft",
    items,
    delivery,
    payment,
    totals,
    createdAt,
    updatedAt: createdAt,
    updatedBy: actor,
    audit: [{ ts: createdAt, actor, action: "create", note: null }],
    instance: input.instance ?? null,
    remoteJid: input.remoteJid ?? null,
  };

  if (isDbEnabled()) {
    await upsertDb(p);
    return p;
  }

  const all = await readAllJson();
  all.push(p);
  await writeAllJson(all);
  return p;
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

  if ("items" in patch) {
    next.items = normalizeItems(patch.items);
  }
  if ("delivery" in patch) {
    next.delivery = normalizeDelivery(patch.delivery);
  }
  if ("payment" in patch) {
    next.payment = normalizePayment(patch.payment);
  }
  next.totals = calcTotals(next.items, next.delivery);

  if ("status" in patch && patch.status != null) {
    next.status = normalizeStatus(patch.status);
  }

  next.audit = Array.isArray(next.audit) ? next.audit.slice(0, 200) : [];
  next.audit.push({
    ts: updatedAt,
    actor,
    action: patch.status ? "set_status" : "update",
    note: typeof patch.note === "string" ? patch.note : null,
  });

  if (isDbEnabled()) {
    await upsertDb(next);
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
  return await updatePreorder(clientId, preorderId, { status, actor, note });
}
