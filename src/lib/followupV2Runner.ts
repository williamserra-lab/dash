// src/lib/followupV2Runner.ts
// Runner do Follow-up (PASSO 7).
//
// - dryRun: lista candidatos (com razões), sem enviar.
// - send: enfileira WhatsApp via Outbox (Evolution), registra timeline e métricas.
//
// Segurança:
// - idempotência: não reenviar se já houver followup_sent para o attempt.
// - limite (controlado no endpoint).

import { getFollowupV2Config } from "@/lib/followupV2Config";
import { appendFollowupMetricEvent } from "@/lib/followupV2Metrics";
import { listBookingsByClient, Booking } from "@/lib/bookings";
import { getPreordersByClient, Preorder } from "@/lib/preorders";
import { getContactById } from "@/lib/contacts";
import { enqueueWhatsappText, listWhatsappOutbox } from "@/lib/whatsappOutboxStore";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";
import { dbQuery, isDbEnabled } from "@/lib/db";

export type FollowupMode = "dryRun" | "send";

export type FollowupCandidate = {
  entityType: "preorder" | "booking";
  entityId: string;
  contactId: string;
  to: string | null;

  status: string;
  createdAt: string;
  startAt?: string | null;

  attempt: 1 | 2;
  reason: string;
};

export type FollowupRunResult = {
  ok: true;
  traceId: string;
  clientId: string;
  mode: FollowupMode;
  ultraSafe: boolean;
  limit: number;
  candidates: FollowupCandidate[];
  actions: Array<
    | { type: "send"; candidate: FollowupCandidate; outboxId: string }
    | { type: "skip"; candidate: FollowupCandidate; reason: string }
    | { type: "error"; candidate: FollowupCandidate; errorCode: string; message: string }
  >;
  conversionsMarked: number;
};

function now() {
  return new Date();
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function hoursBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / (60 * 60 * 1000);
}

function isEligibleStatus(status: string, eligible: string[]): boolean {
  return eligible.includes(status);
}

function chooseAttempt(ageMinutes: number, f1: number, f2: number | null | undefined): 1 | 2 | null {
  if (ageMinutes >= f1 && (f2 == null || ageMinutes < f2)) return 1;
  if (f2 != null && ageMinutes >= f2) return 2;
  return null;
}

async function hasTimelineFollowupSent(clientId: string, entityType: "preorder" | "booking", entityId: string, attempt: 1 | 2): Promise<boolean> {
  const rows = await listTimelineEvents(clientId, entityType as any, entityId);
  return rows.some((r) => r.status === `followup_sent_${attempt}`);
}

async function hasOutboxIdempotency(clientId: string, idempotencyKey: string): Promise<boolean> {
  if (isDbEnabled()) {
    const r = await dbQuery(
      `SELECT id FROM nextia_outbox WHERE client_id=$1 AND idempotency_key=$2 LIMIT 1`,
      [clientId, idempotencyKey]
    );
    return (r.rows || []).length > 0;
  }

  const all = await listWhatsappOutbox({ clientId, limit: 500 });
  return all.some((it) => it.idempotencyKey === idempotencyKey);
}

async function buildToFromContact(clientId: string, contactId: string): Promise<string | null> {
  const c = await getContactById(clientId, contactId);
  if (!c) return null;
  return c.identifier || null;
}

function stopAtForBooking(createdAt: Date, startAtIso: string, stopHours: number, stopBeforeStartMinutes: number): Date {
  const stopByHours = new Date(createdAt.getTime() + stopHours * 60 * 60 * 1000);
  const startAt = new Date(startAtIso);
  const stopByStart = new Date(startAt.getTime() - stopBeforeStartMinutes * 60 * 1000);
  return stopByHours < stopByStart ? stopByHours : stopByStart;
}

function isWithinWindow(createdAt: Date, nowDt: Date, startMinutes: number, stopAt: Date): { ok: boolean; reason?: string } {
  const ageMin = minutesBetween(nowDt, createdAt);
  if (ageMin < startMinutes) return { ok: false, reason: `Ainda cedo (age=${ageMin}m < start=${startMinutes}m)` };
  if (nowDt.getTime() > stopAt.getTime()) return { ok: false, reason: "Fora da janela (stop)" };
  return { ok: true };
}

async function markConversionIfNeeded(params: {
  clientId: string;
  traceId: string;
  configConversionWindowHours: number;
}): Promise<number> {
  // Scan: if there is followup_sent_{attempt} and entity now converted, record followup_converted once.
  // Keep minimal: look back last 200 timeline events per entity is expensive; we do a light approach:
  // - Look at recent metrics "sent" events (last 500) and check conversion.
  let marked = 0;

  // Note: we keep this best-effort; metrics may contain only JSON store.
  // This scan is intentionally conservative.
  return marked;
}

export async function runFollowupV2(input: {
  clientId: string;
  traceId: string;
  mode: FollowupMode;
  limit: number;
  ultraSafe: boolean;
  // standard mode only: allow writing dryrun events to metrics
  recordDryRunMetrics: boolean;
}): Promise<FollowupRunResult> {
  const clientId = input.clientId;
  const cfg = await getFollowupV2Config(clientId);
  const nowDt = now();

  const candidates: FollowupCandidate[] = [];

  if (cfg.enabled && cfg.preorders.enabled) {
    const pre = await getPreordersByClient(clientId);
    for (const p of pre) {
      if (!isEligibleStatus(p.status, cfg.preorders.eligibleStatuses)) continue;

      const createdAt = new Date(p.createdAt);
      const stopAt = new Date(createdAt.getTime() + (cfg.preorders.stopHours ?? 24) * 60 * 60 * 1000);
      const win = isWithinWindow(createdAt, nowDt, cfg.preorders.startMinutes, stopAt);
      if (!win.ok) continue;

      const ageMin = minutesBetween(nowDt, createdAt);
      const attempt = chooseAttempt(ageMin, cfg.preorders.followup1Minutes, cfg.preorders.followup2Minutes);
      if (!attempt) continue;

      const to = p.identifier || (await buildToFromContact(clientId, p.contactId));
      candidates.push({
        entityType: "preorder",
        entityId: p.id,
        contactId: p.contactId,
        to: to || null,
        status: p.status,
        createdAt: p.createdAt,
        startAt: null,
        attempt,
        reason: "Elegível por status + janela",
      });
    }
  }

  if (cfg.enabled && cfg.bookings.enabled) {
    const bookings = await listBookingsByClient(clientId);
    for (const b of bookings) {
      if (!isEligibleStatus(b.status, cfg.bookings.eligibleStatuses)) continue;

      const createdAt = new Date(b.createdAt);
      const stopAt = stopAtForBooking(createdAt, b.startAt, cfg.bookings.stopHours ?? 24, cfg.bookings.stopBeforeStartMinutes ?? 120);
      const win = isWithinWindow(createdAt, nowDt, cfg.bookings.startMinutes, stopAt);
      if (!win.ok) continue;

      const ageMin = minutesBetween(nowDt, createdAt);
      const attempt = chooseAttempt(ageMin, cfg.bookings.followup1Minutes, cfg.bookings.followup2Minutes);
      if (!attempt) continue;

      const to = await buildToFromContact(clientId, b.contactId);
      candidates.push({
        entityType: "booking",
        entityId: b.id,
        contactId: b.contactId,
        to,
        status: b.status,
        createdAt: b.createdAt,
        startAt: b.startAt,
        attempt,
        reason: "Elegível por status + janela",
      });
    }
  }

  // deterministic ordering: oldest first
  candidates.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const limited = candidates.slice(0, Math.max(0, input.limit));
  const actions: FollowupRunResult["actions"] = [];

  if (input.mode === "dryRun") {
    if (input.recordDryRunMetrics && !input.ultraSafe) {
      // Standard (non-ultra) mode: record a dryrun metric event (audit lightweight)
      for (const c of limited) {
        await appendFollowupMetricEvent({
          clientId,
          type: "dryrun",
          entityType: c.entityType,
          entityId: c.entityId,
          attempt: c.attempt,
          traceId: input.traceId,
          to: c.to,
          details: { status: c.status, createdAt: c.createdAt },
        });
      }
    }

    for (const c of limited) actions.push({ type: "skip", candidate: c, reason: "dryRun" });
    return {
      ok: true,
      traceId: input.traceId,
      clientId,
      mode: input.mode,
      ultraSafe: input.ultraSafe,
      limit: input.limit,
      candidates: limited,
      actions,
      conversionsMarked: 0,
    };
  }

  // send mode
  for (const c of limited) {
    try {
      if (!c.to) {
        actions.push({ type: "skip", candidate: c, reason: "Sem número/identificador (to)" });
        continue;
      }

      const alreadyTimeline = await hasTimelineFollowupSent(clientId, c.entityType, c.entityId, c.attempt);
      if (alreadyTimeline) {
        actions.push({ type: "skip", candidate: c, reason: "Já houve followup_sent para este attempt" });
        continue;
      }

      const idempotencyKey = `fu2:${clientId}:${c.entityType}:${c.entityId}:att:${c.attempt}`;
      if (await hasOutboxIdempotency(clientId, idempotencyKey)) {
        actions.push({ type: "skip", candidate: c, reason: "Já enfileirado (idempotencyKey)" });
        continue;
      }

      const message =
        c.entityType === "preorder"
          ? cfg.templates.preorder
          : cfg.templates.booking;

      const out = await enqueueWhatsappText({
        clientId,
        to: c.to,
        message,
        messageType: `followup_v2_${c.entityType}_${c.attempt}`,
        idempotencyKey,
        contactId: c.contactId,
        orderId: null,
        context: { entityType: c.entityType, entityId: c.entityId, attempt: c.attempt, traceId: input.traceId },
      });

      await recordTimelineEvent({
        clientId,
        entityType: c.entityType as any,
        entityId: c.entityId,
        status: `followup_sent_${c.attempt}`,
        actor: "system",
        note: `to=${c.to}`,
      });

      await appendFollowupMetricEvent({
        clientId,
        type: "sent",
        entityType: c.entityType,
        entityId: c.entityId,
        attempt: c.attempt,
        traceId: input.traceId,
        to: c.to,
        details: { outboxId: out.id },
      });

      actions.push({ type: "send", candidate: c, outboxId: out.id });
    } catch (err: any) {
      const errorCode = "FOLLOWUP_SEND_FAILED";
      actions.push({ type: "error", candidate: c, errorCode, message: String(err?.message || err) });

      await recordTimelineEvent({
        clientId,
        entityType: c.entityType as any,
        entityId: c.entityId,
        status: `followup_send_failed_${c.attempt}`,
        actor: "system",
        note: String(err?.message || err),
      }).catch(() => undefined);

      await appendFollowupMetricEvent({
        clientId,
        type: "failed",
        entityType: c.entityType,
        entityId: c.entityId,
        attempt: c.attempt,
        traceId: input.traceId,
        to: c.to,
        errorCode,
        details: { message: String(err?.message || err) },
      }).catch(() => undefined);
    }
  }

  // Conversion mark: minimal in PASSO 7 v1: when entity is now confirmed and we have sent event, mark converted.
  // We'll only check entities we touched in this run (cheap).
  let conversions = 0;
  for (const act of actions) {
    if (act.type !== "send") continue;
    const c = act.candidate;

    if (c.entityType === "preorder") {
      const p = (await getPreordersByClient(clientId)).find((x) => x.id === c.entityId) as Preorder | undefined;
      if (p && p.status === "confirmed") {
        await recordTimelineEvent({
          clientId,
          entityType: "preorder",
          entityId: p.id,
          status: `followup_converted_${c.attempt}`,
          actor: "system",
          note: "status=confirmed",
        }).catch(() => undefined);

        await appendFollowupMetricEvent({
          clientId,
          type: "converted",
          entityType: "preorder",
          entityId: p.id,
          attempt: c.attempt,
          traceId: input.traceId,
          to: c.to,
          details: { conversion: "status_confirmed" },
        }).catch(() => undefined);

        conversions++;
      }
    } else {
      const b = (await listBookingsByClient(clientId)).find((x) => x.id === c.entityId) as Booking | undefined;
      if (b && (b.status === "confirmed" || !!b.clientConfirmedAt)) {
        await recordTimelineEvent({
          clientId,
          entityType: "booking",
          entityId: b.id,
          status: `followup_converted_${c.attempt}`,
          actor: "system",
          note: b.status === "confirmed" ? "status=confirmed" : "client_confirmed",
        }).catch(() => undefined);

        await appendFollowupMetricEvent({
          clientId,
          type: "converted",
          entityType: "booking",
          entityId: b.id,
          attempt: c.attempt,
          traceId: input.traceId,
          to: c.to,
          details: { conversion: b.status === "confirmed" ? "status_confirmed" : "client_confirmed" },
        }).catch(() => undefined);

        conversions++;
      }
    }
  }

  return {
    ok: true,
    traceId: input.traceId,
    clientId,
    mode: input.mode,
    ultraSafe: input.ultraSafe,
    limit: input.limit,
    candidates: limited,
    actions,
    conversionsMarked: conversions,
  };
}
