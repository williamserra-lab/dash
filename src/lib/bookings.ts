// src/lib/bookings.ts
// Agendamentos (contrato "Booking" + "ServiceCalendarConfig" conforme continuidade/chat).
//
// Storage strategy:
// - When NEXTIA_DB_URL is set, persists in Postgres.
// - Otherwise, falls back to JSON store in /data.

import { isDbEnabled, dbQuery } from "@/lib/db";
import { getDataPath, readJsonArray, readJsonValue, writeJsonArray, writeJsonValue } from "@/lib/jsonStore";

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
  clientId: string;
  contactId: string;
  service: ServiceSnapshot;
  startAt: string; // ISO
  endAt: string; // ISO
  status: BookingStatus;
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
  const updatedAt = nowIso();

  const next: ServiceCalendarConfig = {
    clientId,
    workingHours: partial.workingHours,
    defaultDurationMinutes: partial.defaultDurationMinutes,
    bufferMinutes: partial.bufferMinutes,
    simultaneousCapacity: partial.simultaneousCapacity,
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

  const booking: Booking = {
    id,
    clientId: input.clientId,
    contactId: input.contactId,
    service: input.service,
    startAt: input.startAt,
    endAt: input.endAt,
    status,
    collected: input.collected,
    createdAt,
    updatedAt,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_bookings
       (id, client_id, contact_id, service, start_at, end_at, status, collected, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::timestamptz,$6::timestamptz,$7,$8::jsonb,NOW(),NOW())`,
      [
        booking.id,
        booking.clientId,
        booking.contactId,
        JSON.stringify(booking.service),
        booking.startAt,
        booking.endAt,
        booking.status,
        JSON.stringify(booking.collected ?? {}),
      ],
    );
    return booking;
  }

  const list = await readJsonArray<Booking>(bookingsJsonPath(booking.clientId));
  list.push(booking);
  await writeJsonArray(bookingsJsonPath(booking.clientId), list);
  return booking;
}

export async function listBookingsByClient(clientId: string): Promise<Booking[]> {
  requireClientId(clientId);

  if (isDbEnabled()) {
    const r = await dbQuery<{
      id: string;
      client_id: string;
      contact_id: string;
      service: any;
      start_at: string;
      end_at: string;
      status: string;
      collected: any;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, client_id, contact_id, service, start_at, end_at, status, collected, created_at, updated_at
       FROM nextia_bookings
       WHERE client_id = $1
       ORDER BY start_at ASC`,
      [clientId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      contactId: row.contact_id,
      service: row.service ?? { name: "" },
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      status: row.status as BookingStatus,
      collected: row.collected ?? {},
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
      `SELECT id, client_id, contact_id, service, start_at, end_at, status, collected, created_at, updated_at
       FROM nextia_bookings
       WHERE client_id = $1 AND id = $2
       LIMIT 1`,
      [clientId, bookingId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      clientId: row.client_id,
      contactId: row.contact_id,
      service: row.service ?? { name: "" },
      startAt: new Date(row.start_at).toISOString(),
      endAt: new Date(row.end_at).toISOString(),
      status: row.status as BookingStatus,
      collected: row.collected ?? {},
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

  const updated: Booking = { ...current, status, updatedAt: nowIso() };

  if (isDbEnabled()) {
    await dbQuery(
      `UPDATE nextia_bookings
       SET status = $1,
           updated_at = NOW()
       WHERE client_id = $2 AND id = $3`,
      [status, clientId, bookingId],
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
