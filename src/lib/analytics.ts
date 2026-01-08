// src/lib/analytics.ts
// Analytics events (audit + dashboards).
// Primary: Postgres when NEXTIA_DB_URL is enabled. Fallback: JSON file.
// This module keeps backwards-compatible fields used elsewhere in the app.
//
// NOTE: In 29.4 we introduce correlationId + entityRef as first-class fields,
// and normalize "createdAt" to "occurredAt" for DB storage.

export const runtime = "nodejs";

import { isDbEnabled } from "@/lib/db";
import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";
import { dbInsertAnalyticsEvent, dbListAnalyticsEventsByClient, dbListAnalyticsEventsByCorrelation, dbListRecentCorrelations } from "@/lib/analyticsDb";
import crypto from "crypto";

const analyticsFile = getDataPath("analytics_events.json");

/**
 * Keep existing event types (plus new ones used in 28.x/29.x).
 * We intentionally allow unknown strings in DB-level operations, but keep union for app safety.
 */
export type AnalyticsEventType =
  | "order_created"
  | "order_status_changed"
  | "order_confirmed_by_human"
  | "order_cancelled"
  | "whatsapp_outbound_text"
  | "whatsapp_outbound_media"
  | "whatsapp_inbound_message"
  | "campaign_simulated"
  | "campaign_sent"
  | "preorder_created"
  | "preorder_updated"
  | "preorder_confirmed"
  | "preorder_cancelled"
  | "preorder_expired"
  | "booking_created"
  | "booking_updated"
  | "booking_status_changed"
  | "admin_action"
  | "system_error";

/**
 * Backwards-compatible event shape.
 * - `createdAt` remains the canonical timestamp used by the app today.
 * - `occurredAt` is an alias used for future consumers; if absent, it is derived from createdAt.
 * - `payload` remains; `data` is an alias (DB writes use `data`).
 */
export type AnalyticsEvent = {
  id: string;
  type: AnalyticsEventType | (string & {});
  clientId: string;

  // existing optional fields used in older code paths
  contactId?: string | null;
  identifier?: string | null;

  // payload (legacy) + alias
  payload?: unknown;
  data?: unknown;

  // timestamps
  createdAt: string; // ISO
  occurredAt?: string; // ISO (optional alias)

  // 28.4+ (and for 29.3 audit explorer)
  correlationId?: string | null;

  // 29.4: canonical entity reference to support attribution/funnels later
  // Examples: "campaign:<id>", "preorder:<id>", "booking:<id>", "conversation:<id>"
  entityRef?: string | null;

  // optional actor
  actor?: unknown;
};

// -----------------------------
// Helpers
// -----------------------------

function generateId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeOccurredAt(e: Pick<AnalyticsEvent, "createdAt" | "occurredAt">): string {
  return e.occurredAt || e.createdAt;
}

function normalizeData(e: Pick<AnalyticsEvent, "payload" | "data">): unknown {
  return e.data !== undefined ? e.data : e.payload;
}

function toDbInsertInput(e: AnalyticsEvent) {
  return {
    id: e.id,
    clientId: e.clientId,
    eventType: String(e.type),
    occurredAt: normalizeOccurredAt(e),
    correlationId: e.correlationId ?? null,
    entityRef: e.entityRef ?? null,
    actor: e.actor ?? null,
    data: normalizeData(e),
  };
}

// -----------------------------
// JSON store (fallback / shadow copy)
// -----------------------------

async function readAllEventsJson(): Promise<AnalyticsEvent[]> {
  return await readJsonArray<AnalyticsEvent>(analyticsFile);
}

async function writeAllEventsJson(all: AnalyticsEvent[]): Promise<void> {
  await writeJsonArray(analyticsFile, all);
}

async function appendEventJson(e: AnalyticsEvent): Promise<void> {
  const all = await readAllEventsJson();
  all.push(e);
  await writeAllEventsJson(all);
}

// -----------------------------
// DB store (primary)
// -----------------------------

async function readAllEventsDb(clientId?: string | null): Promise<AnalyticsEvent[]> {
  if (!clientId) {
    // This function is only used by summaries; for GLOBAL we fallback to JSON
    // to avoid scanning all DB rows until we have rollups (future patch).
    // If you need global DB scans, add rollups in 29.4+.
    return await readAllEventsJson();
  }

  const rows = await dbListAnalyticsEventsByClient({ clientId, limit: 20000 });
  return rows.map((r) => ({
    id: r.id,
    type: r.event_type as any,
    clientId: r.client_id,
    createdAt: r.occurred_at,
    occurredAt: r.occurred_at,
    correlationId: r.correlation_id,
    entityRef: r.entity_ref,
    actor: r.actor,
    data: r.data,
    payload: r.data,
  }));
}

// -----------------------------
// Public API
// -----------------------------

/**
 * Dual-write:
 * - If DB is enabled: write to DB AND JSON (shadow copy for fallback).
 * - If DB is disabled: write only to JSON.
 *
 * IMPORTANT: No logic changes to how callers use this function.
 */
export async function logAnalyticsEvent(
  event: Omit<AnalyticsEvent, "id">
): Promise<AnalyticsEvent> {
  const entry: AnalyticsEvent = {
    ...event,
    id: generateId("evt"),
  };

  // Always ensure createdAt exists
  if (!entry.createdAt) {
    entry.createdAt = new Date().toISOString();
  }

  // DB primary
  if (isDbEnabled()) {
    try {
      await dbInsertAnalyticsEvent(toDbInsertInput(entry));
    } catch {
      // If DB fails, we still keep JSON fallback; do not throw.
    }
  }

  // JSON shadow/fallback
  await appendEventJson(entry);

  return entry;
}

export type ClientSummary = {
  clientId: string;
  totalEvents: number;

  totalOrdersCreated: number;
  totalOrdersConfirmedByHuman: number;
  totalOrdersCancelled: number;

  totalOutboundText: number;
  totalInbound: number;

  totalCampaignSent: number;
};

export async function getClientSummary(clientId: string): Promise<ClientSummary> {
  const all = await readAllEvents(clientId);
  const events = all.filter((e) => e.clientId === clientId);

  const summary: ClientSummary = {
    clientId,
    totalEvents: events.length,
    totalOrdersCreated: 0,
    totalOrdersConfirmedByHuman: 0,
    totalOrdersCancelled: 0,
    totalOutboundText: 0,
    totalInbound: 0,
    totalCampaignSent: 0,
  };

  for (const e of events) {
    if (e.type === "order_created") summary.totalOrdersCreated++;
    if (e.type === "order_confirmed_by_human") summary.totalOrdersConfirmedByHuman++;
    if (e.type === "order_cancelled") summary.totalOrdersCancelled++;
    if (e.type === "whatsapp_outbound_text") summary.totalOutboundText++;
    if (e.type === "whatsapp_inbound_message") summary.totalInbound++;
    if (e.type === "campaign_sent") summary.totalCampaignSent++;
  }

  return summary;
}

export async function getAllClientsSummary(): Promise<ClientSummary[]> {
  // Global scan: JSON-based until rollups exist.
  const all = await readAllEvents(null);
  const byClient: Record<string, ClientSummary> = {};

  for (const e of all) {
    if (!e.clientId) continue;
    if (!byClient[e.clientId]) {
      byClient[e.clientId] = {
        clientId: e.clientId,
        totalEvents: 0,
        totalOrdersCreated: 0,
        totalOrdersConfirmedByHuman: 0,
        totalOrdersCancelled: 0,
        totalOutboundText: 0,
        totalInbound: 0,
        totalCampaignSent: 0,
      };
    }
    const s = byClient[e.clientId];
    s.totalEvents++;
    if (e.type === "order_created") s.totalOrdersCreated++;
    if (e.type === "order_confirmed_by_human") s.totalOrdersConfirmedByHuman++;
    if (e.type === "order_cancelled") s.totalOrdersCancelled++;
    if (e.type === "whatsapp_outbound_text") s.totalOutboundText++;
    if (e.type === "whatsapp_inbound_message") s.totalInbound++;
    if (e.type === "campaign_sent") s.totalCampaignSent++;
  }

  return Object.values(byClient).sort((a, b) => a.clientId.localeCompare(b.clientId));
}

export type GlobalSummary = {
  totalClients: number;
  totalEvents: number;
  totalOutboundText: number;
  totalInbound: number;
  totalCampaignSent: number;
};

export async function getGlobalSummary(): Promise<GlobalSummary> {
  const byClient = await getAllClientsSummary();
  let totalEvents = 0;
  let totalOutboundText = 0;
  let totalInbound = 0;
  let totalCampaignSent = 0;

  for (const c of byClient) {
    totalEvents += c.totalEvents;
    totalOutboundText += c.totalOutboundText;
    totalInbound += c.totalInbound;
    totalCampaignSent += c.totalCampaignSent;
  }

  return {
    totalClients: byClient.length,
    totalEvents,
    totalOutboundText,
    totalInbound,
    totalCampaignSent,
  };
}

export type DailyClientMetrics = {
  date: string; // YYYY-MM-DD
  outboundText: number;
  inbound: number;
  campaignSent: number;
};

export async function getClientDailyMetrics(
  clientId: string,
  days: number = 14
): Promise<DailyClientMetrics[]> {
  const all = await readAllEvents(clientId);
  const events = all.filter((e) => e.clientId === clientId);

  const byDay: Record<string, DailyClientMetrics> = {};
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    byDay[key] = { date: key, outboundText: 0, inbound: 0, campaignSent: 0 };
  }

  for (const e of events) {
    const ts = normalizeOccurredAt(e);
    const day = ts.slice(0, 10);
    if (!byDay[day]) continue;
    if (e.type === "whatsapp_outbound_text") byDay[day].outboundText++;
    if (e.type === "whatsapp_inbound_message") byDay[day].inbound++;
    if (e.type === "campaign_sent") byDay[day].campaignSent++;
  }

  return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 29.3+ support: list recent correlationIds.
 * - DB: aggregated query
 * - JSON: computed in-memory
 */
export async function listRecentCorrelations(params: {
  clientId?: string | null;
  limit?: number;
}): Promise<{ correlationId: string; clientId?: string | null; lastSeenAt?: string | null; count?: number | null }[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  if (isDbEnabled()) {
    try {
      const rows = await dbListRecentCorrelations({ clientId: params.clientId ?? null, limit });
      return rows.map((r) => ({
        correlationId: r.correlationId,
        clientId: r.clientId,
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
        count: r.count,
      }));
    } catch {
      // fall back to JSON below
    }
  }

  const all = await readAllEventsJson();
  const m = new Map<string, { correlationId: string; clientId?: string | null; lastSeenAt: string; count: number }>();

  for (const e of all) {
    const cid = e.correlationId || "";
    if (!cid) continue;
    if (params.clientId && e.clientId !== params.clientId) continue;
    const key = `${e.clientId}::${cid}`;
    const ts = normalizeOccurredAt(e);

    const prev = m.get(key);
    if (!prev) {
      m.set(key, { correlationId: cid, clientId: e.clientId, lastSeenAt: ts, count: 1 });
    } else {
      prev.count += 1;
      if (ts > prev.lastSeenAt) prev.lastSeenAt = ts;
    }
  }

  return Array.from(m.values())
    .sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""))
    .slice(0, limit)
    .map((x) => ({ correlationId: x.correlationId, clientId: x.clientId, lastSeenAt: x.lastSeenAt, count: x.count }));
}

/**
 * 29.3+ support: list all events for a correlationId.
 */
export async function listEventsByCorrelationId(params: {
  correlationId: string;
  clientId?: string | null;
  limit?: number;
}): Promise<AnalyticsEvent[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 200, 20000));

  if (isDbEnabled()) {
    try {
      const rows = await dbListAnalyticsEventsByCorrelation({
        correlationId: params.correlationId,
        clientId: params.clientId ?? null,
        limit,
      });
      return rows.map((r) => ({
        id: r.id,
        type: r.event_type as any,
        clientId: r.client_id,
        createdAt: r.occurred_at,
        occurredAt: r.occurred_at,
        correlationId: r.correlation_id,
        entityRef: r.entity_ref,
        actor: r.actor,
        data: r.data,
        payload: r.data,
      }));
    } catch {
      // fall back to JSON
    }
  }

  const all = await readAllEventsJson();
  const filtered = all.filter((e) => {
    if (params.clientId && e.clientId !== params.clientId) return false;
    return (e.correlationId || "") === params.correlationId;
  });

  // timeline order
  return filtered
    .sort((a, b) => normalizeOccurredAt(a).localeCompare(normalizeOccurredAt(b)))
    .slice(0, limit);
}

// -----------------------------
// Internal: choose store for reads
// -----------------------------

async function readAllEvents(clientId: string | null): Promise<AnalyticsEvent[]> {
  if (isDbEnabled()) {
    try {
      return await readAllEventsDb(clientId);
    } catch {
      // fall back to JSON
    }
  }
  return await readAllEventsJson();
}
