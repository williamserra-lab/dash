// src/lib/conversationEvents.ts
// Append-only audit trail for each conversation.
// Primary: Postgres (when NEXTIA_DB_URL is enabled). Fallback: JSON file.

import { dbQuery, isDbEnabled } from "./db";
import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";
import crypto from "crypto";

const EVENTS_FILE = getDataPath("conversation_events.json");

export type ConversationEventType =
  | "inbound"
  | "outbox_enqueued"
  | "outbox_sent"
  | "state_transition"
  | "handoff_created"
  | "handoff_accepted"
  | "handoff_resolved"
  | "error";

export type ReasonCode =
  | "OUT_OF_SCOPE"
  | "ADDRESS_UNRESOLVED"
  | "PAYMENT_UNCLEAR"
  | "AMBIGUOUS_INTENT"
  | "MENU_MISMATCH"
  | "SYSTEM_ERROR";

export type ConversationEvent = {
  id: string;
  createdAt: string; // ISO
  clientId: string;
  instance: string;
  remoteJid: string;
  eventType: ConversationEventType;
  dedupeKey?: string | null;
  reasonCode?: ReasonCode | string | null;
  payload?: unknown;
  meta?: Record<string, unknown> | null;
};

function sha1(v: string): string {
  return crypto.createHash("sha1").update(v).digest("hex");
}

export function makeEventId(parts: {
  clientId: string;
  instance: string;
  remoteJid: string;
  eventType: ConversationEventType;
  dedupeKey?: string | null;
}): string {
  const base = [
    parts.clientId,
    parts.instance,
    parts.remoteJid,
    parts.eventType,
    parts.dedupeKey || crypto.randomUUID(),
  ].join("|");
  return sha1(base);
}

export async function appendConversationEvent(
  ev: ConversationEvent
): Promise<{ ok: true; deduped?: boolean } | { ok: false; error: string }> {
  if (isDbEnabled()) {
    try {
      await dbQuery(
        `
        INSERT INTO nextia_conversation_events
          (id, client_id, instance, remote_jid, event_type, dedupe_key, reason_code, payload, meta)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        ON CONFLICT (id) DO NOTHING;
        `,
        [
          ev.id,
          ev.clientId,
          ev.instance,
          ev.remoteJid,
          ev.eventType,
          ev.dedupeKey ?? null,
          ev.reasonCode ?? null,
          JSON.stringify(ev.payload ?? null),
          JSON.stringify(ev.meta ?? null),
        ]
      );
      return { ok: true };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.toLowerCase().includes("duplicate key") || msg.toLowerCase().includes("unique")) {
        return { ok: true, deduped: true };
      }
      return { ok: false, error: msg };
    }
  }

  // JSON fallback (local dev / no DB)
  try {
    const list = await readJsonArray<ConversationEvent>(EVENTS_FILE);
    if (list.some((x) => x && typeof x === "object" && (x as any).id === ev.id)) {
      return { ok: true, deduped: true };
    }

    const normalized: ConversationEvent = {
      ...ev,
      createdAt: typeof ev.createdAt === "string" && ev.createdAt ? ev.createdAt : new Date().toISOString(),
    };

    list.push(normalized);

    // Keep the file bounded (best-effort) to avoid unbounded growth.
    const MAX = 20000;
    if (list.length > MAX) {
      // Drop oldest.
      list.splice(0, list.length - MAX);
    }

    await writeJsonArray(EVENTS_FILE, list);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function listConversationEvents(params: {
  clientId: string;
  instance: string;
  remoteJid: string;
  limit?: number;
}): Promise<ConversationEvent[]> {
  const limit = typeof params.limit === "number" && params.limit > 0 ? Math.min(params.limit, 500) : 200;

  if (isDbEnabled()) {
    const res = await dbQuery<any>(
      `
      SELECT
        id,
        created_at,
        client_id,
        instance,
        remote_jid,
        event_type,
        dedupe_key,
        reason_code,
        payload,
        meta
      FROM nextia_conversation_events
      WHERE client_id = $1 AND instance = $2 AND remote_jid = $3
      ORDER BY created_at DESC
      LIMIT $4;
      `,
      [params.clientId, params.instance, params.remoteJid, limit]
    );

    return (res.rows || []).map((r) => ({
      id: String(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      clientId: String(r.client_id),
      instance: String(r.instance),
      remoteJid: String(r.remote_jid),
      eventType: String(r.event_type) as ConversationEventType,
      dedupeKey: r.dedupe_key ?? null,
      reasonCode: r.reason_code ?? null,
      payload: r.payload ?? null,
      meta: r.meta ?? null,
    }));
  }

  // JSON fallback
  const list = await readJsonArray<ConversationEvent>(EVENTS_FILE);
  const filtered = list
    .filter((x) => x && typeof x === "object")
    .filter((x) => (x as any).clientId === params.clientId && (x as any).instance === params.instance && (x as any).remoteJid === params.remoteJid);

  filtered.sort((a, b) => {
    const ta = Date.parse(a.createdAt || "") || 0;
    const tb = Date.parse(b.createdAt || "") || 0;
    return tb - ta;
  });

  return filtered.slice(0, limit);
}
