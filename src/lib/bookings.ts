// src/lib/bookings.ts
// Agendamentos (contrato "Booking" + "ServiceCalendarConfig" conforme continuidade/chat).
//
// Storage strategy:
// - When NEXTIA_DB_URL is set, persists in Postgres.
// - Otherwise, falls back to JSON store in /data.

import { isDbEnabled, dbQuery } from "@/lib/db";
import { formatPublicId, nextCounter } from "@/lib/counters";
import { getDataPath, readJsonArray, readJsonValue, writeJsonArray, writeJsonValue } from "@/lib/jsonStore";
import { recordTimelineEvent } from "@/lib/timeline";

export type BookingStatus =
  | "requested"
  | "awaiting_confirmation"
  | "confirmed"
  | "cancelled"
  | "no_show";

export type ServiceSnapshot = {
  name: string;
  durationMinutes?: number;
  price?: number | null;
};

export type CollectedFields = {
  name?: string;
  address?: string;
  notes?: string;
};

export type Booking = {
  id: string;
  publicId?: string | null;
  clientId: string;
  contactId: string;
  attendantId: string;
  service: ServiceSnapshot;
  startAt: string; // ISO
  endAt: string; // ISO
  status: BookingStatus;
  // confirmação do cliente
  reminderSentAt?: string | null;
  confirmByAt?: string | null;
  clientConfirmedAt?: string | null;
  cancelReason?: string | null;
  // no-show
  noShowMarkedAt?: string | null;
  noShowReason?: string | null;
  collected?: CollectedFields;
  createdAt: string; // ISO
  updatedAt: string; // ISO
};

export type ServiceCalendarConfig = {
  clientId: string;
  // e.g. { mon: [{start:"09:00", end:"18:00"}], tue: ... }
  workingHours?: Record<string, Array<{ start: string; end: string }>>;
  defaultDurationMinutes?: number;
  bufferMinutes?: number;
  simultaneousCapacity?: number;

  // mensagens transacionais (configuráveis pelo lojista)
  bookingConfirmedMessageTemplate?: string;
  bookingReminderMessageTemplate?: string;
  bookingReminderConfirmLeadHours?: number; // ex.: 2 (cliente precisa confirmar pelo menos X horas antes)
  bookingNoShowGraceMinutes?: number; // ex.: 15 (tolerância para marcar no-show)
  // (compat legado) 
  bookingReminderConfirmUntilLocalTime?: string; // HH:MM (deprecated)

  updatedAt: string; // ISO
};

function nowIso(): string {
  return new Date().toISOString();
}

function bookingsJsonPath(clientId: string): string {
  return getDataPath(`bookings_${clientId}.json`);
}

function configJsonPath(clientId: string): string {
  return getDataPath(`service_calendar_config_${clientId}.json`);
}

function requireClientId(clientId: string): void {
  if (!clientId || typeof clientId !== "string") throw new Error("clientId inválido");
}

function requireBookingStatus(status: string): asserts status is BookingStatus {
  const allowed: BookingStatus[] = [
    "requested",
    "awaiting_confirmation",
    "confirmed",
    "cancelled",
    "no_show",
  ];
  if (!allowed.includes(status as BookingStatus)) {
    throw new Error(`status inválido: ${status}`);
  }
}

export async function upsertServiceCalendarConfig(
  clientId: string,
  partial: Omit<ServiceCalendarConfig, "clientId" | "updatedAt">,
): Promise<ServiceCalendarConfig> {
  requireClientId(clientId);
  // Proteção contra overwrite acidental:
  // o frontend pode enviar apenas parte do payload e, se gravarmos "undefined",
  // acabamos apagando configurações já existentes.
  const current = await getServiceCalendarConfig(clientId);
  const updatedAt = nowIso();

  const next: ServiceCalendarConfig = {
    clientId,
    workingHours: partial.workingHours ?? current?.workingHours,
    defaultDurationMinutes: partial.defaultDurationMinutes ?? current?.defaultDurationMinutes,
    bufferMinutes: partial.bufferMinutes ?? current?.bufferMinutes,
    simultaneousCapacity: partial.simultaneousCapacity ?? current?.simultaneousCapacity,
    bookingConfirmedMessageTemplate:
      partial.bookingConfirmedMessageTemplate ?? current?.bookingConfirmedMessageTemplate,
    bookingReminderMessageTemplate:
      partial.bookingReminderMessageTemplate ?? current?.bookingReminderMessageTemplate,
    bookingReminderConfirmLeadHours:
      partial.bookingReminderConfirmLeadHours ?? current?.bookingReminderConfirmLeadHours,
    bookingNoShowGraceMinutes:
      (partial as any).bookingNoShowGraceMinutes ?? current?.bookingNoShowGraceMinutes,
    bookingReminderConfirmUntilLocalTime:
      partial.bookingReminderConfirmUntilLocalTime ?? current?.bookingReminderConfirmUntilLocalTime,
    updatedAt,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_service_calendar_config (client_id, config, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (client_id)
       DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
      [clientId, JSON.stringify(next)],
    );
    return next;
  }

  await writeJsonValue(configJsonPath(clientId), next);
  return next;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const BLOCKING_STATUSES: BookingStatus[] = ["requested", "awaiting_confirmation", "confirmed"];

async function assertNoConflicts(clientId: string, contactId: string, attendantId: string, startAtIso: string, endAtIso: string): Promise<void> {
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);

  if (isDbEnabled()) {
    const r = await dbQuery<{ id: string }>(
      `SELECT id
         FROM nextia_bookings
        WHERE client_id=$1
          AND status = ANY($2)
          AND (
                (attendant_id = $3) OR (contact_id = $4)
              )
          AND start_at < $6::timestamptz
          AND end_at   > $5::timestamptz
        LIMIT 1`,
      [clientId, BLOCKING_STATUSES, attendantId, contactId, startAtIso, endAtIso]
    );
    if (r.rows.length) {
      throw new Error("conflict");
    }
    return;
  }

  const all = await listBookingsByClient(clientId);
  const conflict = all.find((b) => {
    if (!BLOCKING_STATUSES.includes(b.status)) return false;
    if (b.attendantId !== attendantId && b.contactId !== contactId) return false;
    return overlaps(new Date(b.startAt), new Date(b.endAt), start, end);
  });
  if (conflict) throw new Error("conflict");
}

export async function getServiceCalendarConfig(clientId: string): Promise<ServiceCalendarConfig | null> {
  requireClientId(clientId);

  if (isDbEnabled()) {
    const r = await dbQuery<{ config: any }>(
      `SELECT config FROM nextia_service_calendar_config WHERE client_id = $1 LIMIT 1`,
      [clientId],
    );
    if (!r.rows[0]?.config) return null;
    return r.rows[0].config as ServiceCalendarConfig;
  }

  const v = await readJsonValue<ServiceCalendarConfig | null>(configJsonPath(clientId), null);
  return v ?? null;
}

export type CreateBookingInput = {
  clientId: string;
  contactId: string;
  attendantId: string;
  service: ServiceSnapshot;
  startAt: string;
  endAt: string;
  status?: BookingStatus;
  collected?: CollectedFields;
};

export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  requireClientId(input.clientId);
  if (!input.contactId) throw new Error("contactId inválido");
  if (!input.service?.name) throw new Error("service.name é obrigatório");
  if (!input.startAt || !input.endAt) throw new Error("startAt/endAt são obrigatórios");

  const createdAt = nowIso();
  const updatedAt = createdAt;
  const id = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `bk_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const status: BookingStatus = input.status ?? "requested";
  requireBookingStatus(status);

  let publicId: string | null = null;
  if (status === "confirmed") {
    const seq = await nextCounter(input.clientId, "booking");
    publicId = formatPublicId("AG", seq);
  }

  const booking: Booking = {
    id,
    publicId,
    clientId: input.clientId,
    contactId: input.contactId,
    attendantId: input.attendantId || "default",
    service: input.service,
    startAt: input.startAt,
    endAt: input.endAt,
    status,
    reminderSentAt: null,
    confirmByAt: null,
    clientConfirmedAt: null,
    cancelReason: null,
    noShowMarkedAt: null,
    noShowReason: null,
    collected: input.collected,
    createdAt,
    updatedAt,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_bookings
       (id, client_id, contact_id, attendant_id, service, start_at, end_at, status, collected, reminder_sent_at, confirm_by_at, client_confirmed_at, cancel_reason, no_show_marked_at, no_show_reason, public_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7::timestamptz,$8,$9::jsonb,$10::timestamptz,$11::timestamptz,$12::timestamptz,$13,$14::timestamptz,$15,$16,NOW(),NOW())`,
      [
        booking.id,
        booking.clientId,
        booking.contactId,
        booking.attendantId,
        JSON.stringify(booking.service),
        booking.startAt,
        booking.endAt,
        booking.status,
        JSON.stringify(booking.collected ?? {}),
        booking.reminderSentAt,
        booking.confirmByAt,
        booking.clientConfirmedAt,
        booking.cancelReason,
        booking.noShowMarkedAt,
        booking.noShowReason,
        booking.publicId,
      ],
    );
    // Timeline (PASSO 5) - best-effort
    try {
      await recordTimelineEvent({
        clientId: booking.clientId,
        entityType: "booking",
        entityId: booking.id,
        status: booking.status,
        at: booking.createdAt,
        actor: "merchant",
        note: "created",
      });
    } catch (e) {
      console.error("timeline:createBooking", e);
    }
    return booking;
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(booking.clientId));
  list.push(booking);
  await writeJsonArray(bookingsJsonPath(booking.clientId), list);
  // Timeline (PASSO 5) - best-effort
  try {
    await recordTimelineEvent({
      clientId: booking.clientId,
      entityType: "booking",
      entityId: booking.id,
      status: booking.status,
      at: booking.createdAt,
      actor: "merchant",
      note: "created",
    });
  } catch (e) {
    console.error("timeline:createBooking", e);
  }
  return booking;
}

export async function listBookingsByClient(clientId: string): Promise<Booking[]> {
  requireClientId(clientId);

  if (isDbEnabled()) {
    const r = await dbQuery<{
      id: string;
      public_id: string | null;
      client_id: string;
      contact_id: string;
      attendant_id: string | null;
      service: any;
      start_at: string;
      end_at: string;
      status: string;
      collected: any;
      reminder_sent_at: string | null;
      confirm_by_at: string | null;
      client_confirmed_at: string | null;
      cancel_reason: string | null;
      no_show_marked_at: string | null;
      no_show_reason: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, public_id, client_id, contact_id, attendant_id, service, start_at, end_at, status, collected, reminder_sent_at, confirm_by_at, client_confirmed_at, cancel_reason, no_show_marked_at, no_show_reason, created_at, updated_at
       FROM nextia_bookings
       WHERE client_id = $1
       ORDER BY start_at ASC`,
      [clientId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      publicId: row.public_id ?? null,
      clientId: row.client_id,
      contactId: row.contact_id,
        attendantId: row.attendant_id || "default",
      service: row.service ?? { name: "" },
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      status: row.status as BookingStatus,
      collected: row.collected ?? {},
      reminderSentAt: row.reminder_sent_at ? new Date(row.reminder_sent_at).toISOString() : null,
      confirmByAt: row.confirm_by_at ? new Date(row.confirm_by_at).toISOString() : null,
      clientConfirmedAt: row.client_confirmed_at ? new Date(row.client_confirmed_at).toISOString() : null,
      cancelReason: row.cancel_reason ?? null,
      noShowMarkedAt: row.no_show_marked_at ? new Date(row.no_show_marked_at).toISOString() : null,
      noShowReason: row.no_show_reason ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  return await readJsonArray<Booking>(bookingsJsonPath(clientId));
}

export async function getBookingById(clientId: string, bookingId: string): Promise<Booking | null> {
  requireClientId(clientId);
  if (!bookingId) throw new Error("bookingId inválido");

  if (isDbEnabled()) {
    const r = await dbQuery<any>(
      `SELECT id, public_id, client_id, contact_id, attendant_id, service, start_at, end_at, status, collected, reminder_sent_at, confirm_by_at, client_confirmed_at, cancel_reason, no_show_marked_at, no_show_reason, created_at, updated_at
       FROM nextia_bookings
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [clientId, bookingId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      publicId: row.public_id ?? null,
      clientId: row.client_id,
      contactId: row.contact_id,
        attendantId: row.attendant_id || "default",
      service: row.service ?? { name: "" },
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      status: row.status as BookingStatus,
      collected: row.collected ?? {},
      reminderSentAt: row.reminder_sent_at ? new Date(row.reminder_sent_at).toISOString() : null,
      confirmByAt: row.confirm_by_at ? new Date(row.confirm_by_at).toISOString() : null,
      clientConfirmedAt: row.client_confirmed_at ? new Date(row.client_confirmed_at).toISOString() : null,
      cancelReason: row.cancel_reason ?? null,
      noShowMarkedAt: row.no_show_marked_at ? new Date(row.no_show_marked_at).toISOString() : null,
      noShowReason: row.no_show_reason ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  return list.find((b) => b.id === bookingId) ?? null;
}

export type UpdateBookingInput = Partial<Pick<Booking, "service" | "startAt" | "endAt" | "collected">>;

export async function updateBooking(
  clientId: string,
  bookingId: string,
  patch: UpdateBookingInput,
): Promise<Booking> {
  const current = await getBookingById(clientId, bookingId);
  if (!current) throw new Error("booking não encontrado");

  const updated: Booking = {
    ...current,
    service: patch.service ?? current.service,
    startAt: patch.startAt ?? current.startAt,
    endAt: patch.endAt ?? current.endAt,
    collected: patch.collected ?? current.collected,
    updatedAt: nowIso(),
  };

  if (isDbEnabled()) {
    await dbQuery(
      `UPDATE nextia_bookings
       SET service = $1::jsonb,
           start_at = $2::timestamptz,
           end_at = $3::timestamptz,
           collected = $4::jsonb,
           updated_at = NOW()
       WHERE client_id = $5 AND id = $6`,
      [
        JSON.stringify(updated.service),
        updated.startAt,
        updated.endAt,
        JSON.stringify(updated.collected ?? {}),
        clientId,
        bookingId,
      ],
    );
    return updated;
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = list.findIndex((b) => b.id === bookingId);
  if (idx < 0) throw new Error("booking não encontrado");
  list[idx] = updated;
  await writeJsonArray(bookingsJsonPath(clientId), list);
  return updated;
}

export async function setBookingStatus(
  clientId: string,
  bookingId: string,
  status: BookingStatus,
): Promise<Booking> {
  requireBookingStatus(status);
  const current = await getBookingById(clientId, bookingId);
  if (!current) throw new Error("booking não encontrado");

  // Evita duplicar eventos de timeline se o status já é o mesmo.
  if (current.status === status) return current;

  const updatedAt = nowIso();
  let publicId = current.publicId ?? null;

  // Gera número humano apenas quando o booking é confirmado (aceito).
  if (status === "confirmed" && !publicId) {
    const seq = await nextCounter(clientId, "booking");
    publicId = formatPublicId("AG", seq);
  }

  const updated: Booking = { ...current, status, publicId, updatedAt };

  if (isDbEnabled()) {
    const r = await dbQuery<{ public_id: string | null }>(
      `UPDATE nextia_bookings
       SET status = $1,
           public_id = COALESCE(public_id, $4),
           updated_at = NOW()
       WHERE client_id = $2 AND id = $3
       RETURNING public_id`,
      [status, clientId, bookingId, publicId],
    );

    const storedPublicId = r.rows?.[0]?.public_id ?? null;
    const out = { ...updated, publicId: storedPublicId };
    try {
      await recordTimelineEvent({
        clientId,
        entityType: "booking",
        entityId: bookingId,
        status: out.status,
        at: out.updatedAt,
        actor: "merchant",
      });
    } catch (e) {
      console.error("timeline:setBookingStatus", e);
    }
    return out;
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = list.findIndex((b) => b.id === bookingId);
  if (idx < 0) throw new Error("booking não encontrado");
  list[idx] = updated;
  await writeJsonArray(bookingsJsonPath(clientId), list);
  try {
    await recordTimelineEvent({
      clientId,
      entityType: "booking",
      entityId: bookingId,
      status: updated.status,
      at: updated.updatedAt,
      actor: "merchant",
    });
  } catch (e) {
    console.error("timeline:setBookingStatus", e);
  }
  return updated;
}




export async function markBookingNoShowManual(clientId: string, bookingId: string, reason?: string): Promise<Booking> {
  requireClientId(clientId);
  if (!bookingId) throw new Error("bookingId inválido");

  const current = await getBookingById(clientId, bookingId);
  if (!current) throw new Error("booking não encontrado");

  const now = nowIso();
  const updated: Booking = {
    ...current,
    status: "no_show",
    noShowMarkedAt: now,
    noShowReason: reason ? String(reason).slice(0, 200) : "manual_no_show",
    updatedAt: now,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `UPDATE nextia_bookings
         SET status = $1,
             no_show_marked_at = NOW(),
             no_show_reason = $2,
             updated_at = NOW()
       WHERE client_id = $3 AND id = $4`,
      ["no_show", updated.noShowReason, clientId, bookingId],
    );
    try {
      await recordTimelineEvent({
        clientId,
        entityType: "booking",
        entityId: bookingId,
        status: "no_show",
        at: updated.updatedAt,
        actor: "merchant",
        note: updated.noShowReason ?? null,
      });
    } catch (e) {
      console.error("timeline:markBookingNoShowManual", e);
    }
    return updated;
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = list.findIndex((b) => b.id === bookingId);
  if (idx < 0) throw new Error("booking não encontrado");
  list[idx] = updated;
  await writeJsonArray(bookingsJsonPath(clientId), list);
  try {
    await recordTimelineEvent({
      clientId,
      entityType: "booking",
      entityId: bookingId,
      status: "no_show",
      at: updated.updatedAt,
      actor: "merchant",
      note: updated.noShowReason ?? null,
    });
  } catch (e) {
    console.error("timeline:markBookingNoShowManual", e);
  }
  return updated;
}

// --- Confirmação do cliente (D-1 / X horas antes) ---

function hoursToMs(h: number): number {
  return Math.max(0, h) * 60 * 60 * 1000;
}


function parseNoShowGraceMinutes(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 15;
  return Math.max(0, Math.min(240, Math.floor(n)));
}

function parseLeadHours(v: any): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 2;
  if (n <= 0) return 2;
  if (n > 168) return 168;
  return Math.floor(n);
}

export function computeConfirmByAt(startAtIso: string, leadHours: number): string {
  const start = new Date(startAtIso);
  const confirmBy = new Date(start.getTime() - hoursToMs(leadHours));
  return confirmBy.toISOString();
}

export async function setBookingAwaitingConfirmation(
  clientId: string,
  bookingId: string,
  confirmByAtIso: string,
  reminderSentAtIso: string,
  dryRun = false,
): Promise<Booking | null> {
  requireClientId(clientId);
  if (isDbEnabled()) {
    if (!dryRun) {
      await dbQuery(
        `UPDATE nextia_bookings
         SET status='awaiting_confirmation',
             confirm_by_at = $3::timestamptz,
             reminder_sent_at = $4::timestamptz,
             updated_at = NOW()
         WHERE client_id=$1 AND id=$2`,
        [clientId, bookingId, confirmByAtIso, reminderSentAtIso],
      );
    }
    const all = await listBookingsByClient(clientId);
    return all.find((b) => b.id === bookingId) ?? null;
  }

  const all = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = all.findIndex((b) => b.id === bookingId);
  if (idx === -1) return null;
  const b = all[idx];
  const next: Booking = {
    ...b,
    status: "awaiting_confirmation",
    confirmByAt: confirmByAtIso,
    reminderSentAt: reminderSentAtIso,
    updatedAt: nowIso(),
  };
  all[idx] = next;
  if (!dryRun) await writeJsonArray(bookingsJsonPath(clientId), all);
  return next;
}

export async function confirmBookingByClient(
  clientId: string,
  bookingId: string,
  confirmedAtIso: string,
  dryRun = false,
): Promise<Booking | null> {
  requireClientId(clientId);
  if (isDbEnabled()) {
    if (!dryRun) {
      await dbQuery(
        `UPDATE nextia_bookings
         SET status='confirmed',
             client_confirmed_at = $3::timestamptz,
             updated_at = NOW()
         WHERE client_id=$1 AND id=$2`,
        [clientId, bookingId, confirmedAtIso],
      );
    }
    const all = await listBookingsByClient(clientId);
    return all.find((b) => b.id === bookingId) ?? null;
  }

  const all = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = all.findIndex((b) => b.id === bookingId);
  if (idx === -1) return null;
  const b = all[idx];
  const next: Booking = {
    ...b,
    status: "confirmed",
    clientConfirmedAt: confirmedAtIso,
    updatedAt: nowIso(),
  };
  all[idx] = next;
  if (!dryRun) await writeJsonArray(bookingsJsonPath(clientId), all);
  return next;
}

export async function cancelBookingBySystem(
  clientId: string,
  bookingId: string,
  reason: string,
  dryRun = false,
): Promise<Booking | null> {
  requireClientId(clientId);
  if (isDbEnabled()) {
    if (!dryRun) {
      await dbQuery(
        `UPDATE nextia_bookings
         SET status='cancelled',
             cancel_reason = $3,
             updated_at = NOW()
         WHERE client_id=$1 AND id=$2`,
        [clientId, bookingId, reason],
      );
    }
    const all = await listBookingsByClient(clientId);
    return all.find((b) => b.id === bookingId) ?? null;
  }

  const all = await readJsonArray<Booking>(bookingsJsonPath(clientId));
  const idx = all.findIndex((b) => b.id === bookingId);
  if (idx === -1) return null;
  const b = all[idx];
  const next: Booking = {
    ...b,
    status: "cancelled",
    cancelReason: reason,
    updatedAt: nowIso(),
  };
  all[idx] = next;
  if (!dryRun) await writeJsonArray(bookingsJsonPath(clientId), all);
  return next;
}

export async function findAwaitingConfirmationByContact(
  clientId: string,
  contactId: string,
): Promise<Booking | null> {
  const all = await listBookingsByClient(clientId);
  const now = new Date();
  const candidates = all
    .filter((b) => b.contactId === contactId)
    .filter((b) => b.status === "awaiting_confirmation")
    .filter((b) => new Date(b.startAt) > now)
    .sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  return candidates[0] ?? null;
}

export type BookingConfirmationRunResult = {
  clientId: string;
  scanned: number;
  remindersSent: number;
  autoCancelled: number;
  reminderBookingIds: string[];
  autoCancelledBookingIds: string[];
  dryRun: boolean;
};

// Envia lembretes "um dia antes" (ou imediatamente se < 24h) e cancela se não confirmar até (startAt - leadHours)
export async function runBookingConfirmationCycle(opts: {
  clientId?: string;
  limit?: number;
  dryRun?: boolean;
}): Promise<BookingConfirmationRunResult[]> {
  const dryRun = Boolean(opts.dryRun);
  const limit = typeof opts.limit === "number" ? Math.max(1, Math.min(500, opts.limit)) : 200;

  // lista de clients: por enquanto, quando não passa clientId, não temos index global no JSON.
  // Então exigimos clientId no runner externo.
  const clientIds = opts.clientId ? [opts.clientId] : [];
  const results: BookingConfirmationRunResult[] = [];

  for (const clientId of clientIds) {
    const config = (await getServiceCalendarConfig(clientId)) ?? ({ clientId, updatedAt: nowIso() } as ServiceCalendarConfig);
    const leadHours = parseLeadHours((config as any).bookingReminderConfirmLeadHours ?? 2);

    const all = await listBookingsByClient(clientId);
    const now = new Date();

    let scanned = 0;
    let remindersSent = 0;
    let autoCancelled = 0;
    const reminderBookingIds: string[] = [];
    const autoCancelledBookingIds: string[] = [];

    for (const b of all) {
      if (scanned >= limit) break;
      if (b.status === "cancelled" || b.status === "no_show") continue;

      const start = new Date(b.startAt);
      if (!(start > now)) continue;

      scanned++;

      const confirmByAtIso = computeConfirmByAt(b.startAt, leadHours);
      const confirmBy = new Date(confirmByAtIso);

      // 1) Auto-cancel se passou do deadline e ainda não confirmou
      if (b.status === "awaiting_confirmation") {
        const confirmed = Boolean(b.clientConfirmedAt);
        if (!confirmed && now >= confirmBy) {
          await cancelBookingBySystem(clientId, b.id, "no_confirmation_before_deadline", dryRun);
          autoCancelled++;
          autoCancelledBookingIds.push(b.id);
        }
        continue;
      }

      // 2) Enviar lembrete: janela padrão = [start-24h, confirmBy)
      // Se start-24h já passou, envia imediatamente (se ainda não enviado)
      if (b.status === "confirmed") {
        const reminderWindowStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
        const inWindow = now >= reminderWindowStart && now < confirmBy;
        const already = Boolean((b as any).reminderSentAt);
        if (inWindow && !already) {
          // marcar awaiting_confirmation e o resto do envio fica por conta do runner externo (API) para ter acesso ao contato
          await setBookingAwaitingConfirmation(clientId, b.id, confirmByAtIso, now.toISOString(), dryRun);
          remindersSent++;
          reminderBookingIds.push(b.id);
        }
      }
    }

    results.push({ clientId, scanned, remindersSent, autoCancelled, reminderBookingIds, autoCancelledBookingIds, dryRun });
  }

  return results;
}


// --- No-show (janela de tolerância) ---

export type BookingNoShowRunResult = {
  clientId: string;
  scanned: number;
  marked: number;
  dryRun: boolean;
  bookingIds: string[];
};

export async function runBookingNoShowCycle(opts: {
  clientId: string;
  limit?: number;
  dryRun?: boolean;
  graceMinutes?: number;
}): Promise<BookingNoShowRunResult> {
  const clientId = String(opts.clientId || "").trim();
  if (!clientId) throw new Error("clientId é obrigatório");

  const dryRun = Boolean(opts.dryRun);
  const limit = typeof opts.limit === "number" ? Math.max(1, Math.min(500, opts.limit)) : 200;

  const config =
    (await getServiceCalendarConfig(clientId)) ??
    ({ clientId, updatedAt: nowIso() } as ServiceCalendarConfig);

  const grace = parseNoShowGraceMinutes(
    opts.graceMinutes ?? (config as any).bookingNoShowGraceMinutes ?? 15
  );

  const all = await listBookingsByClient(clientId);
  const now = new Date();

  let scanned = 0;
  let marked = 0;
  const bookingIds: string[] = [];

  for (const b of all) {
    if (scanned >= limit) break;
    if (b.status !== "confirmed" && b.status !== "awaiting_confirmation") continue;

    const start = new Date(b.startAt);
    if (!(now >= new Date(start.getTime() + grace * 60 * 1000))) continue;

    scanned++;
    bookingIds.push(b.id);

    if (dryRun) {
      marked++;
      continue;
    }

    await markBookingNoShowManual(clientId, b.id, "auto_no_show");
    marked++;
  }

  return { clientId, scanned, marked, dryRun, bookingIds };
}
