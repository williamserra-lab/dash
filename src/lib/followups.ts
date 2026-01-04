import { readJsonValue, writeJsonValue } from "@/lib/jsonStore";

type Vertical = "delivery" | "appointments";

export type FollowupMessageType = "followup1" | "followup2" | "softclose";

export type FollowupToSend = {
  orderId: string;
  clientId: string;
  attempt: number;
  messageType: FollowupMessageType;
  message: string;
};

type RunInput = {
  clientId?: string;
  vertical: Vertical;
  nowIso?: string;
};

type OrderLike = any;

type OutboxItem = {
  id?: string;
  createdAt?: string;
  clientId: string;
  channel: "whatsapp";
  to?: string;
  message?: string;
  kind?: string;
  idempotencyKey?: string | null;
  orderId: string;
  messageType: string;
  status?: "pending" | "sent" | "failed";
  type?: string;
};

type AuditEvent =
  | {
      type: "followup";
      orderId: string;
      clientId: string;
      vertical: Vertical;
      attempt: number;
      messageType: FollowupMessageType;
      at: string;
    }
  | {
      type: "abandoned";
      orderId: string;
      clientId: string;
      vertical: Vertical;
      at: string;
    };

type AuditRec = {
  clientId: string;
  events: AuditEvent[];
};

type AuditStore = Record<string, AuditRec>;

type RunResult = {
  evaluated: number;
  abandoned: number;
  queued: number;
  wroteOrders: boolean;
  wroteAudit: boolean;
  wroteOutbox: boolean;
  followupsToSend: FollowupToSend[];
};

const ORDERS_FILE = "data/orders.json";
const OUTBOX_FILE = "data/whatsapp_outbox.json";
const AUDIT_FILE = "data/order_followups.json";

function nowIso(x?: string) {
  const s = (x || "").trim();
  if (s) return s;
  return new Date().toISOString();
}

function minutesBetween(aMs: number, bMs: number) {
  const d = Math.abs(aMs - bMs);
  return Math.floor(d / 60000);
}

function asArray(x: any) {
  return Array.isArray(x) ? x : [];
}

/**
 * Migrates any legacy shapes inside order_followups.json into canonical events-based store.
 * - Keeps existing canonical entries as-is.
 * - Converts legacy "attempts" records (key like clientId:orderId:vertical) into events under orderId.
 * - Drops legacy entries after migration (canonical-only file on write).
 */
function migrateAuditToCanonical(raw: any): AuditStore {
  const canonical: AuditStore = {};
  if (!raw || typeof raw !== "object") return canonical;

  // If already canonical-ish: object keyed by orderId -> {clientId, events[]}
  const keys = Object.keys(raw);
  for (const key of keys) {
    const v = (raw as any)[key];

    // canonical entry?
    if (v && typeof v === "object" && Array.isArray(v.events) && typeof v.clientId === "string") {
      canonical[key] = {
        clientId: v.clientId,
        events: v.events.filter(Boolean) as AuditEvent[],
      };
      continue;
    }

    // legacy attempt-based entries: key looks like "clientId:orderId:vertical"
    if (typeof key === "string" && key.includes(":") && v && typeof v === "object") {
      const parts = key.split(":");
      if (parts.length >= 3) {
        const clientId = parts[0];
        const orderId = parts[1];
        const vertical = parts.slice(2).join(":") as any;

        const rec = canonical[orderId] ?? { clientId, events: [] as AuditEvent[] };
        rec.clientId = rec.clientId || clientId;

        // v might be like { attempt1At, attempt2At, ... } or any custom
        // We'll convert known fields into followup events when possible.
        const attempt1At = (v as any).attempt1At || (v as any).followup1At;
        const attempt2At = (v as any).attempt2At || (v as any).followup2At;
        const abandonedAt = (v as any).abandonedAt;

        if (attempt1At && typeof attempt1At === "string") {
          rec.events.push({
            type: "followup",
            orderId,
            clientId,
            vertical: vertical === "appointments" ? "appointments" : "delivery",
            attempt: 1,
            messageType: "followup1",
            at: attempt1At,
          });
        }
        if (attempt2At && typeof attempt2At === "string") {
          rec.events.push({
            type: "followup",
            orderId,
            clientId,
            vertical: vertical === "appointments" ? "appointments" : "delivery",
            attempt: 2,
            messageType: "followup2",
            at: attempt2At,
          });
        }
        if (abandonedAt && typeof abandonedAt === "string") {
          rec.events.push({
            type: "abandoned",
            orderId,
            clientId,
            vertical: vertical === "appointments" ? "appointments" : "delivery",
            at: abandonedAt,
          });
        }

        canonical[orderId] = rec;
        continue;
      }
    }

    // Unknown entry: ignore
    void key;
  }

  return canonical;
}

async function readAuditCanonical(): Promise<AuditStore> {
  const raw = await readJsonValue<any>(AUDIT_FILE, {});
  return migrateAuditToCanonical(raw);
}

async function writeAuditCanonical(audit: AuditStore) {
  // Write canonical-only (format B) to stop future drift.
  await writeJsonValue(AUDIT_FILE, audit);
}

function getPolicy(vertical: Vertical) {
  // Baseline conservative defaults. These can later be made client-configurable.
  if (vertical === "appointments") {
    return {
      // After X minutes without new contact interaction, send followups
      followup1Min: 60,
      followup2Min: 180,
      softCloseMin: 24 * 60,
    };
  }

  return {
    followup1Min: 45,
    followup2Min: 120,
    softCloseMin: 12 * 60,
  };
}

function followupMessages() {
  return {
    followup1: "Só confirmando: posso te ajudar com mais alguma coisa?",
    followup2: "Se preferir, posso te orientar rapidinho por aqui. Como você quer seguir?",
    softclose: "Vou encerrar por enquanto para não te incomodar. Quando quiser, é só me chamar aqui.",
  };
}

function getOrderId(o: OrderLike): string | null {
  if (!o || typeof o !== "object") return null;
  const id = (o as any).id ?? (o as any).orderId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function getClientId(o: OrderLike): string | null {
  if (!o || typeof o !== "object") return null;
  const id = (o as any).clientId ?? (o as any).client?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function verticalMatches(o: OrderLike, vertical: Vertical) {
  // Heuristic:
  // - appointments: has appointmentId or professionalId or scheduledAt
  // - delivery: has delivery fields
  if (vertical === "appointments") {
    return Boolean((o as any).appointmentId || (o as any).scheduledAt || (o as any).professionalId);
  }
  // delivery default
  return true;
}

function getLastInteractionAt(o: OrderLike): string | null {
  // Prefer explicit last interaction; else updatedAt; else createdAt.
  const a = (o as any).interactionDate ?? (o as any).lastInteractionAt ?? (o as any).updatedAt ?? (o as any).createdAt;
  return typeof a === "string" && a.trim() ? a.trim() : null;
}

function getTo(o: OrderLike): string {
  const t = (o as any).whatsappNumber ?? (o as any).to ?? (o as any).contact?.identifier ?? "";
  return typeof t === "string" ? t : "";
}

function isAbandoned(status: any) {
  return status === "abandonado" || status === "abandoned";
}

function addFollowupEvent(
  a: AuditStore,
  orderId: string,
  clientId: string,
  vertical: Vertical,
  attempt: number,
  messageType: FollowupMessageType,
  at: string
) {
  const rec = a[orderId] ?? { clientId, events: [] };
  rec.clientId = rec.clientId || clientId;
  rec.events.push({ type: "followup", orderId, clientId, vertical, attempt, messageType, at });
  a[orderId] = rec;
}

function addAbandonedEvent(a: AuditStore, orderId: string, clientId: string, vertical: Vertical, at: string) {
  const rec = a[orderId] ?? { clientId, events: [] };
  rec.clientId = rec.clientId || clientId;
  if (!rec.events.some((e) => e.type === "abandoned")) {
    rec.events.push({ type: "abandoned", orderId, clientId, vertical, at });
  }
  a[orderId] = rec;
}

function outboxKey(clientId: string, orderId: string, messageType: FollowupMessageType) {
  return `${clientId}:${orderId}:${messageType}`;
}

function isFollowupOutboxItem(x: any): x is OutboxItem {
  if (!x || typeof x !== "object") return false;
  if (typeof x.orderId !== "string") return false;
  if (typeof x.clientId !== "string") return false;
  if (x.channel !== "whatsapp") return false;
  if (typeof x.messageType !== "string") return false;
  return true;
}

export async function runFollowupsAndQueue(input: RunInput): Promise<{ ok: true; result: RunResult }> {
  const now = nowIso(input.nowIso);
  const nowMs = Date.parse(now);
  const policy = getPolicy(input.vertical);
  const msg = followupMessages();

  const ordersRaw = await readJsonValue<any>(ORDERS_FILE, []);
  const orders: any[] = asArray(ordersRaw);

  const outboxRaw = await readJsonValue<any>(OUTBOX_FILE, []);
  const outbox: any[] = Array.isArray(outboxRaw) ? outboxRaw : [];

  const audit = await readAuditCanonical();

  // Index only followup items for idempotency.
  const outboxIndex = new Set(
    outbox
      .filter(isFollowupOutboxItem)
      .map((i: OutboxItem) => outboxKey(i.clientId, i.orderId, i.messageType as FollowupMessageType))
  );

  const followupsToSend: FollowupToSend[] = [];
  let evaluated = 0;
  let abandoned = 0;
  let ordersChanged = false;

  for (const o of orders) {
    const orderId = getOrderId(o);
    const clientId = getClientId(o);

    if (!orderId || !clientId) continue;
    if (input.clientId && clientId !== input.clientId) continue;
    if (!verticalMatches(o, input.vertical)) continue;

    evaluated += 1;

    const last = getLastInteractionAt(o);
    if (!last) continue;

    const lastMs = Date.parse(last);
    if (!Number.isFinite(lastMs)) continue;

    const inactiveMin = minutesBetween(nowMs, lastMs);

    // Soft close
    if (inactiveMin >= policy.softCloseMin) {
      if (!isAbandoned((o as any).status)) {
        (o as any).status = "abandonado";
        (o as any).abandonedAt = now;
        ordersChanged = true;
        abandoned += 1;
        addAbandonedEvent(audit, orderId, clientId, input.vertical, now);

        const key = outboxKey(clientId, orderId, "softclose");
        if (!outboxIndex.has(key)) {
          outboxIndex.add(key);
          outbox.push({
            id: `out_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
            createdAt: now,
            clientId,
            channel: "whatsapp",
            to: getTo(o),
            kind: "message",
            idempotencyKey: outboxKey(clientId, orderId, "softclose"),
            orderId,
            messageType: "softclose",
            message: msg.softclose,
            status: "pending",
            type: "followup_message",
          });
        }
      }
      continue;
    }

    // followup2
    if (inactiveMin >= policy.followup2Min) {
      const key = outboxKey(clientId, orderId, "followup2");
      if (!outboxIndex.has(key)) {
        outboxIndex.add(key);
        outbox.push({
          id: `out_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
          createdAt: now,
          clientId,
          channel: "whatsapp",
          to: getTo(o),
          kind: "message",
          idempotencyKey: outboxKey(clientId, orderId, "followup2"),
          orderId,
          messageType: "followup2",
          message: msg.followup2,
          status: "pending",
          type: "followup_message",
        });

        followupsToSend.push({ orderId, clientId, attempt: 2, messageType: "followup2", message: msg.followup2 });
        addFollowupEvent(audit, orderId, clientId, input.vertical, 2, "followup2", now);
      }
      continue;
    }

    // followup1
    if (inactiveMin >= policy.followup1Min) {
      const key = outboxKey(clientId, orderId, "followup1");
      if (!outboxIndex.has(key)) {
        outboxIndex.add(key);
        outbox.push({
          id: `out_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`,
          createdAt: now,
          clientId,
          channel: "whatsapp",
          to: getTo(o),
          kind: "message",
          idempotencyKey: outboxKey(clientId, orderId, "followup1"),
          orderId,
          messageType: "followup1",
          message: msg.followup1,
          status: "pending",
          type: "followup_message",
        });

        followupsToSend.push({ orderId, clientId, attempt: 1, messageType: "followup1", message: msg.followup1 });
        addFollowupEvent(audit, orderId, clientId, input.vertical, 1, "followup1", now);
      }
      continue;
    }
  }

  let wroteOrders = false;
  let wroteAudit = false;
  let wroteOutbox = false;

  if (ordersChanged) {
    await writeJsonValue(ORDERS_FILE, orders);
    wroteOrders = true;
  }

  if (followupsToSend.length > 0 || abandoned > 0) {
    await writeAuditCanonical(audit);
    wroteAudit = true;

    await writeJsonValue(OUTBOX_FILE, outbox);
    wroteOutbox = true;
  }

  const result: RunResult = {
    evaluated,
    abandoned,
    queued: followupsToSend.length,
    wroteOrders,
    wroteAudit,
    wroteOutbox,
    followupsToSend,
  };

  return { ok: true, result };
}
