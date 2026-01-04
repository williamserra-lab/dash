// src/lib/whatsappOutboxStore.ts
// Canonical Outbox for WhatsApp messages.
// - Primary storage: Postgres (when NEXTIA_DB_URL is set)
// - Fallback storage: JSON file (data/whatsapp_outbox.json)
//
// Note: Campaign logic depends on this schema.

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { dbQuery, isDbEnabled } from "./db";
import { appendConversationEvent, makeEventId } from "./conversationEvents";

export type OutboxStatus = "pending" | "sent" | "failed";

export type WhatsAppOutboxBase = {
  id: string;
  createdAt: string;
  clientId: string;
  channel: "whatsapp";
  status: OutboxStatus;

  // When present, do not process before this ISO timestamp
  notBefore?: string | null;

  contactId?: string | null;

  // Business linkage
  orderId?: string | null;
  messageType?: string | null;

  // Idempotency (optional)
  idempotencyKey?: string | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider?: any;
};

export type WhatsAppOutboxText = WhatsAppOutboxBase & {
  kind: "text";
  to: string; // digits or jid
  message: string;
};

export type WhatsAppOutboxItem = WhatsAppOutboxText;

export type EnqueueTextInput = {
  clientId: string;
  to: string;
  message: string;
  notBefore?: string | null;
  contactId?: string | null;
  orderId?: string | null;
  messageType?: string | null;
  idempotencyKey?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any;
};

function dataDir(): string {
  return path.join(process.cwd(), "data");
}

function outboxPath(): string {
  return path.join(dataDir(), "whatsapp_outbox.json");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeWhatsAppTo(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  // Allow group or jid formats
  if (v.includes("@g.us")) return v;
  if (v.includes("@s.whatsapp.net")) return v;
  // Otherwise digits
  return v.replace(/\D+/g, "");
}

function makeId(prefix: string): string {
  const rnd =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (crypto as any).randomUUID === "function"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (crypto as any).randomUUID().replace(/-/g, "").slice(0, 16)
      : crypto.randomBytes(10).toString("hex");
  return `${prefix}${rnd}`;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
}

async function readOutboxJson(): Promise<WhatsAppOutboxItem[]> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(outboxPath(), "utf-8");
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    return list as WhatsAppOutboxItem[];
  } catch {
    return [];
  }
}

async function writeOutboxJson(list: WhatsAppOutboxItem[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(outboxPath(), JSON.stringify(list, null, 2), "utf-8");
}

export async function enqueueWhatsappText(input: EnqueueTextInput): Promise<WhatsAppOutboxText> {
  const clientId = String(input.clientId || "").trim();
  const to = normalizeWhatsAppTo(input.to);
  const message = String(input.message || "").trim();

  if (!clientId) throw new Error("enqueueWhatsappText: clientId é obrigatório.");
  if (!to) throw new Error("enqueueWhatsappText: 'to' é obrigatório.");
  if (!message) throw new Error("enqueueWhatsappText: 'message' é obrigatório.");

  const orderId = input.orderId ?? null;
  const messageType = input.messageType ?? null;
  const idempotencyKey = (input.idempotencyKey ?? null) as string | null;

  const item: WhatsAppOutboxText = {
    id: makeId("wout_"),
    kind: "text",
    createdAt: nowIso(),
    clientId,
    channel: "whatsapp",
    status: "pending",
    to,
    message,
    notBefore: input.notBefore ?? null,
    contactId: input.contactId ?? null,
    orderId,
    messageType,
    idempotencyKey,
    context: input.context ?? null,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `
      INSERT INTO nextia_outbox
        (id, created_at, updated_at, client_id, channel, status, "to", message,
         not_before, contact_id, order_id, message_type, idempotency_key, context, provider)
      VALUES
        ($1, $2, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13, $14);
      `,
      [
        item.id,
        item.createdAt,
        item.clientId,
        item.channel,
        item.status,
        item.to,
        item.message,
        item.notBefore ? item.notBefore : null,
        item.contactId,
        item.orderId,
        item.messageType,
        item.idempotencyKey,
        item.context ?? null,
        null,
      ]
    );
    
  // Audit trail (DB): outbox enqueued (best-effort)
  try {
    const instance = String(process.env.EVOLUTION_INSTANCE || "NextIA");
    await appendConversationEvent({
      id: makeEventId({ clientId: item.clientId, instance, remoteJid: item.to, eventType: "outbox_enqueued", dedupeKey: item.id }),
      createdAt: item.createdAt,
      clientId: item.clientId,
      instance,
      remoteJid: item.to,
      eventType: "outbox_enqueued",
      dedupeKey: item.id,
      payload: { outboxId: item.id, messageType: item.messageType || null },
      meta: { kind: "whatsapp_text" },
    });
  } catch (e) {
    // never break enqueue
    console.error("[OUTBOX] falha ao registrar evento outbox_enqueued:", e);
  }

return item;
  }

  // JSON fallback
  const list = await readOutboxJson();

  // Idempotency: if key is provided and still pending/sent, do not enqueue again.
  if (idempotencyKey) {
    const exists = list.find((x) => (x as any)?.idempotencyKey === idempotencyKey);
    if (exists) return exists as WhatsAppOutboxText;
  }

  list.push(item);
  await writeOutboxJson(list);
  return item;
}

export async function updateOutboxStatusById(
  id: string,
  status: OutboxStatus,
  patch?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context?: any;
  }
): Promise<boolean> {
  const outboxId = String(id || "").trim();
  if (!outboxId) return false;

  if (isDbEnabled()) {
    const res = await dbQuery(
      `
      UPDATE nextia_outbox
      SET status=$2, updated_at=NOW(),
          provider=COALESCE($3, provider),
          context=COALESCE($4, context)
      WHERE id=$1;
      `,
      [outboxId, status, patch?.provider ?? null, patch?.context ?? null]
    );
    return (res.rowCount || 0) > 0;
  }

  const list = await readOutboxJson();
  let changed = false;

  const next = list.map((it) => {
    if (!it || typeof it !== "object") return it;
    if (String((it as any).id || "") !== outboxId) return it;
    changed = true;
    return {
      ...(it as any),
      status,
      updatedAt: nowIso(),
      ...(patch?.provider ? { provider: patch.provider } : null),
      ...(patch?.context ? { context: patch.context } : null),
    } as WhatsAppOutboxItem;
  });

  if (changed) await writeOutboxJson(next);
  return changed;
}

export async function listWhatsappOutbox(filter?: {
  clientId?: string;
  status?: OutboxStatus;
  limit?: number;
}): Promise<WhatsAppOutboxItem[]> {
  const clientId = (filter?.clientId || "").trim();
  const status = filter?.status;
  const limit = typeof filter?.limit === "number" && filter.limit > 0 ? filter.limit : 200;

  if (isDbEnabled()) {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (clientId) {
      clauses.push(`client_id=$${p++}`);
      params.push(clientId);
    }
    if (status) {
      clauses.push(`status=$${p++}`);
      params.push(status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const res = await dbQuery<{
      id: string;
      created_at: string;
      updated_at: string;
      client_id: string;
      channel: string;
      status: string;
      to: string;
      message: string;
      not_before: string | null;
      contact_id: string | null;
      order_id: string | null;
      message_type: string | null;
      idempotency_key: string | null;
      context: unknown;
      provider: unknown;
    }>(
      `
      SELECT id, created_at, updated_at, client_id, channel, status, "to", message,
             not_before, contact_id, order_id, message_type, idempotency_key, context, provider
      FROM nextia_outbox
      ${where}
      ORDER BY created_at DESC
      LIMIT $${p};
      `,
      [...params, limit]
    );

    return res.rows.map((r) => ({
      id: r.id,
      kind: "text",
      createdAt: r.created_at,
      clientId: r.client_id,
      channel: "whatsapp",
      status: (r.status as OutboxStatus) || "pending",
      to: r.to,
      message: r.message,
      notBefore: r.not_before,
      contactId: r.contact_id,
      orderId: r.order_id,
      messageType: r.message_type,
      idempotencyKey: r.idempotency_key,
      context: r.context,
      provider: r.provider,
    }));
  }

  const items = await readOutboxJson();
  const filtered = items.filter((it) => {
    if (clientId && it.clientId !== clientId) return false;
    if (status && it.status !== status) return false;
    return true;
  });

  return filtered.slice(-limit).reverse();
}

export async function listPendingOutboxForRun(params: {
  clientId?: string;
  limit?: number;
}): Promise<WhatsAppOutboxItem[]> {
  const clientId = String(params.clientId || "").trim();
  const limit = Math.max(1, Math.min(500, Number(params.limit || 100)));

  if (isDbEnabled()) {
    const clauses: string[] = [];
    const args: unknown[] = [];
    let p = 1;

    clauses.push(`status='pending'`);
    if (clientId) {
      clauses.push(`client_id=$${p++}`);
      args.push(clientId);
    }

    // not_before: allow null or <= now
    clauses.push(`(not_before IS NULL OR not_before <= NOW())`);

    const res = await dbQuery<{
      id: string;
      created_at: string;
      client_id: string;
      status: string;
      to: string;
      message: string;
      not_before: string | null;
      contact_id: string | null;
      order_id: string | null;
      message_type: string | null;
      idempotency_key: string | null;
      context: unknown;
      provider: unknown;
    }>(
      `
      SELECT id, created_at, client_id, status, "to", message, not_before,
             contact_id, order_id, message_type, idempotency_key, context, provider
      FROM nextia_outbox
      WHERE ${clauses.join(" AND ")}
      ORDER BY created_at ASC
      LIMIT $${p};
      `,
      [...args, limit]
    );

    return res.rows.map((r) => ({
      id: r.id,
      kind: "text",
      createdAt: r.created_at,
      clientId: r.client_id,
      channel: "whatsapp",
      status: (r.status as OutboxStatus) || "pending",
      to: r.to,
      message: r.message,
      notBefore: r.not_before,
      contactId: r.contact_id,
      orderId: r.order_id,
      messageType: r.message_type,
      idempotencyKey: r.idempotency_key,
      context: r.context,
      provider: r.provider,
    }));
  }

  // JSON fallback
  const items = await readOutboxJson();
  const now = Date.now();

  return items
    .filter((it) => {
      if (it.status !== "pending") return false;
      if (clientId && it.clientId !== clientId) return false;
      if (it.notBefore) {
        const t = Date.parse(it.notBefore);
        if (!Number.isNaN(t) && t > now) return false;
      }
      return true;
    })
    .slice(0, limit);
}

export async function cancelPendingWhatsappOutboxByCampaign(params: {
  clientId: string;
  campaignId: string;
}): Promise<{ canceled: number }> {
  const clientId = String(params.clientId || "").trim();
  const campaignId = String(params.campaignId || "").trim();
  if (!clientId || !campaignId) return { canceled: 0 };

  // DB mode: mark matching pending items as failed (canceled)
  if (isDbEnabled()) {
    // match by context JSON: {kind:"campaign", campaignId:"..."}
    // This is safe but requires a JSONB query.
    const res = await dbQuery(
      `
      UPDATE nextia_outbox
      SET status='failed', updated_at=NOW(),
          provider=COALESCE(provider, '{}'::jsonb) || jsonb_build_object('canceledAt', NOW(), 'cancelReason', 'campaign canceled')
      WHERE client_id=$1 AND status='pending'
        AND (context->>'kind')='campaign'
        AND (context->>'campaignId')=$2;
      `,
      [clientId, campaignId]
    );
    return { canceled: res.rowCount || 0 };
  }

  // JSON fallback (legacy)
  const items = await readOutboxJson();
  const now = nowIso();
  let canceled = 0;

  const next = items.map((it) => {
    if (!it || typeof it !== "object") return it;
    if (String((it as any).clientId || "").trim() !== clientId) return it;

    const context = (it as any).context as any;
    const kind = context?.kind;
    const ctxCampaignId = context?.campaignId;

    const rawStatus = (it as any).status;
    const statusLower =
      rawStatus === undefined || rawStatus === null || rawStatus === ""
        ? "pending"
        : String(rawStatus).toLowerCase();

    const isPending = statusLower === "pending";

    if (kind === "campaign" && ctxCampaignId === campaignId && isPending) {
      canceled += 1;
      return {
        ...(it as any),
        status: "failed",
        canceledAt: now,
        cancelReason: "campaign canceled",
      } as WhatsAppOutboxItem;
    }

    return it;
  });

  if (canceled > 0) await writeOutboxJson(next as WhatsAppOutboxItem[]);
  return { canceled };
}

export async function cancelPendingWhatsappOutboxByGroupCampaign(params: {
  clientId: string;
  groupCampaignId: string;
}): Promise<{ canceled: number }> {
  const clientId = String(params.clientId || "").trim();
  const groupCampaignId = String(params.groupCampaignId || "").trim();
  if (!clientId || !groupCampaignId) return { canceled: 0 };

  if (isDbEnabled()) {
    const res = await dbQuery(
      `
      UPDATE nextia_outbox
      SET status='failed', updated_at=NOW(),
          provider=COALESCE(provider, '{}'::jsonb) || jsonb_build_object('canceledAt', NOW(), 'cancelReason', 'group_campaign canceled')
      WHERE client_id=$1 AND status='pending'
        AND (context->>'kind')='group_campaign'
        AND (context->>'groupCampaignId')=$2;
      `,
      [clientId, groupCampaignId]
    );
    return { canceled: res.rowCount || 0 };
  }

  const items = await readOutboxJson();
  const now = nowIso();
  let canceled = 0;

  const next = items.map((it) => {
    if (!it || typeof it !== "object") return it;
    if (String((it as any).clientId || "").trim() !== clientId) return it;

    const context = (it as any).context as any;
    const kind = context?.kind;
    const ctxId = context?.groupCampaignId;

    const rawStatus = (it as any).status;
    const statusLower =
      rawStatus === undefined || rawStatus === null || rawStatus === ""
        ? "pending"
        : String(rawStatus).toLowerCase();

    const isPending = statusLower === "pending";

    if (kind === "group_campaign" && ctxId === groupCampaignId && isPending) {
      canceled += 1;
      return {
        ...(it as any),
        status: "failed",
        canceledAt: now,
        cancelReason: "group_campaign canceled",
      } as WhatsAppOutboxItem;
    }

    return it;
  });

  if (canceled > 0) await writeOutboxJson(next as WhatsAppOutboxItem[]);
  return { canceled };
}
