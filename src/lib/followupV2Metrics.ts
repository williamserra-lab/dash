// src/lib/followupV2Metrics.ts
// Métricas mínimas e auditáveis do Follow-up (PASSO 7).
//
// Storage: data/followup_metrics.json (array de eventos).

import { createId } from "@/lib/id";
import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type FollowupMetricEventType = "sent" | "failed" | "converted" | "dryrun";

export type FollowupMetricEvent = {
  id: string;
  clientId: string;
  at: string; // ISO
  type: FollowupMetricEventType;

  entityType: "preorder" | "booking";
  entityId: string;

  attempt: 1 | 2;
  traceId: string;

  // metadata
  to?: string | null;
  errorCode?: string | null;
  details?: unknown;
};

const FILE = "followup_metrics.json";

function nowIso() {
  return new Date().toISOString();
}

export async function appendFollowupMetricEvent(ev: Omit<FollowupMetricEvent, "id" | "at"> & { at?: string }): Promise<FollowupMetricEvent> {
  const full: FollowupMetricEvent = {
    id: createId("fum_"),
    at: ev.at ?? nowIso(),
    ...ev,
  };

  const path = getDataPath(FILE);
  const all = await readJsonArray<FollowupMetricEvent>(path);
  all.push(full);
  // keep file bounded
  const max = 5000;
  const trimmed = all.length > max ? all.slice(all.length - max) : all;
  await writeJsonArray(path, trimmed);
  return full;
}

export async function listFollowupMetricEvents(filter: { clientId: string; limit?: number }): Promise<FollowupMetricEvent[]> {
  const path = getDataPath(FILE);
  const all = await readJsonArray<FollowupMetricEvent>(path);
  const clientId = filter.clientId;
  const limit = typeof filter.limit === "number" && filter.limit > 0 ? Math.min(filter.limit, 2000) : 500;
  return all.filter((e) => e.clientId === clientId).slice(-limit).reverse();
}

export type FollowupMetricSummary = {
  clientId: string;
  now: string;

  sent: { today: number; d7: number; d30: number };
  converted: { today: number; d7: number; d30: number };

  conversionRateD7: number; // converted/sent
  conversionRateD30: number;

  avgMinutesToConvertD30: number | null;
};

function withinDays(evAt: Date, now: Date, days: number): boolean {
  const ms = days * 24 * 60 * 60 * 1000;
  return now.getTime() - evAt.getTime() <= ms;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export function computeFollowupMetricSummary(clientId: string, events: FollowupMetricEvent[]): FollowupMetricSummary {
  const now = new Date();
  let sentToday = 0, sent7 = 0, sent30 = 0;
  let convToday = 0, conv7 = 0, conv30 = 0;

  // avg minutes to convert (30d): join by (entityType, entityId, attempt) using earliest sent then first converted
  type Key = string;
  const sentAtByKey = new Map<Key, Date>();
  const convDeltas: number[] = [];

  for (const ev of events) {
    const at = new Date(ev.at);
    if (ev.type === "sent") {
      const k = `${ev.entityType}:${ev.entityId}:${ev.attempt}`;
      if (!sentAtByKey.has(k)) sentAtByKey.set(k, at);

      if (sameDay(at, now)) sentToday++;
      if (withinDays(at, now, 7)) sent7++;
      if (withinDays(at, now, 30)) sent30++;
    }
  }

  for (const ev of events) {
    const at = new Date(ev.at);
    if (ev.type === "converted") {
      if (sameDay(at, now)) convToday++;
      if (withinDays(at, now, 7)) conv7++;
      if (withinDays(at, now, 30)) conv30++;

      // delta
      if (withinDays(at, now, 30) && ev.details && typeof (ev.details as any).sentAt === "string") {
        const sentAt = new Date((ev.details as any).sentAt);
        const minutes = Math.max(0, Math.round((at.getTime() - sentAt.getTime()) / 60000));
        convDeltas.push(minutes);
      }
    }
  }

  const rate7 = sent7 > 0 ? conv7 / sent7 : 0;
  const rate30 = sent30 > 0 ? conv30 / sent30 : 0;
  const avg = convDeltas.length ? Math.round(convDeltas.reduce((a, b) => a + b, 0) / convDeltas.length) : null;

  return {
    clientId,
    now: now.toISOString(),
    sent: { today: sentToday, d7: sent7, d30: sent30 },
    converted: { today: convToday, d7: conv7, d30: conv30 },
    conversionRateD7: rate7,
    conversionRateD30: rate30,
    avgMinutesToConvertD30: avg,
  };
}
