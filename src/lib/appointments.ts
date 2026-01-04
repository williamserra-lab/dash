// src/lib/appointments.ts
// Agendamentos (services, professionals, appointments)
// Storage strategy:
// - If NEXTIA_DB_URL is set: Postgres (via dbQuery)
// - Else: JSON files in /data (services.json, professionals.json, appointments.json)

import { isDbEnabled, dbQuery } from "@/lib/db";
import { readJsonArray, writeJsonValue, getDataPath } from "@/lib/jsonStore";

export type Service = {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  basePrice?: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Professional = {
  id: string;
  clientId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentStatus =
  | "solicitado"
  | "confirmado"
  | "concluido"
  | "cancelado"
  | "no_show";

export type PaymentTiming = "antecipado" | "no_local";
export type PaymentMethod = "pix" | "dinheiro" | "cartao" | "outro";

export type Appointment = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string; // telefone
  contactName?: string;
  serviceId: string;
  serviceName: string;
  professionalId: string;
  professionalName: string;
  startDateTime: string; // ISO
  endDateTime: string; // ISO
  status: AppointmentStatus;
  paymentTiming?: PaymentTiming | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

const SERVICES_FILE = getDataPath("services.json");
const PROFESSIONALS_FILE = getDataPath("professionals.json");
const APPOINTMENTS_FILE = getDataPath("appointments.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMinutesIso(startIso: string, minutes: number): string {
  const d = new Date(startIso);
  d.setMinutes(d.getMinutes() + Math.max(0, Math.floor(minutes)));
  return d.toISOString();
}

function normStr(v: unknown): string {
  return String(v ?? "").trim();
}

function normOptStr(v: unknown): string | undefined {
  const s = normStr(v);
  return s ? s : undefined;
}

function toBool(v: unknown, dflt: boolean): boolean {
  return typeof v === "boolean" ? v : dflt;
}

function toInt(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeService(x: any): Service | null {
  const id = normStr(x?.id);
  const clientId = normStr(x?.clientId);
  const name = normStr(x?.name);
  if (!id || !clientId || !name) return null;
  const createdAt = normStr(x?.createdAt) || nowIso();
  const updatedAt = normStr(x?.updatedAt) || createdAt;
  return {
    id,
    clientId,
    name,
    description: normOptStr(x?.description),
    durationMinutes: Math.max(1, toInt(x?.durationMinutes, 30)),
    basePrice: toNumOrNull(x?.basePrice),
    active: toBool(x?.active, true),
    createdAt,
    updatedAt,
  };
}

function normalizeProfessional(x: any): Professional | null {
  const id = normStr(x?.id);
  const clientId = normStr(x?.clientId);
  const name = normStr(x?.name);
  if (!id || !clientId || !name) return null;
  const createdAt = normStr(x?.createdAt) || nowIso();
  const updatedAt = normStr(x?.updatedAt) || createdAt;
  return { id, clientId, name, active: toBool(x?.active, true), createdAt, updatedAt };
}

function normalizeAppointment(x: any): Appointment | null {
  const id = normStr(x?.id);
  const clientId = normStr(x?.clientId);
  const contactId = normStr(x?.contactId);
  const identifier = normStr(x?.identifier);
  const serviceId = normStr(x?.serviceId);
  const professionalId = normStr(x?.professionalId);
  const startDateTime = normStr(x?.startDateTime);
  const endDateTime = normStr(x?.endDateTime);
  if (!id || !clientId || !contactId || !identifier || !serviceId || !professionalId || !startDateTime || !endDateTime) {
    return null;
  }
  const createdAt = normStr(x?.createdAt) || nowIso();
  const updatedAt = normStr(x?.updatedAt) || createdAt;
  const status = (normStr(x?.status) || "solicitado") as AppointmentStatus;
  return {
    id,
    clientId,
    contactId,
    identifier,
    contactName: normOptStr(x?.contactName),
    serviceId,
    serviceName: normStr(x?.serviceName) || "",
    professionalId,
    professionalName: normStr(x?.professionalName) || "",
    startDateTime,
    endDateTime,
    status,
    paymentTiming: (x?.paymentTiming ?? null) as any,
    paymentMethod: (x?.paymentMethod ?? null) as any,
    notes: normOptStr(x?.notes),
    createdAt,
    updatedAt,
  };
}

// ---------------- JSON store ----------------

async function readAllServicesJson(): Promise<Service[]> {
  const raw = await readJsonArray<any>(SERVICES_FILE);
  const out: Service[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const s = normalizeService(r);
    if (s) out.push(s);
  }
  return out;
}

async function writeAllServicesJson(all: Service[]): Promise<void> {
  await writeJsonValue(SERVICES_FILE, all);
}

async function readAllProfessionalsJson(): Promise<Professional[]> {
  const raw = await readJsonArray<any>(PROFESSIONALS_FILE);
  const out: Professional[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const p = normalizeProfessional(r);
    if (p) out.push(p);
  }
  return out;
}

async function writeAllProfessionalsJson(all: Professional[]): Promise<void> {
  await writeJsonValue(PROFESSIONALS_FILE, all);
}

async function readAllAppointmentsJson(): Promise<Appointment[]> {
  const raw = await readJsonArray<any>(APPOINTMENTS_FILE);
  const out: Appointment[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const a = normalizeAppointment(r);
    if (a) out.push(a);
  }
  return out;
}

async function writeAllAppointmentsJson(all: Appointment[]): Promise<void> {
  await writeJsonValue(APPOINTMENTS_FILE, all);
}

// ---------------- DB helpers ----------------

type DbServiceRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  base_price: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function rowToService(r: DbServiceRow): Service {
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    description: r.description ?? undefined,
    durationMinutes: Number(r.duration_minutes),
    basePrice: r.base_price === null ? null : Number(r.base_price),
    active: !!r.active,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

type DbProfessionalRow = {
  id: string;
  client_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function rowToProfessional(r: DbProfessionalRow): Professional {
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    active: !!r.active,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

type DbAppointmentRow = {
  id: string;
  client_id: string;
  contact_id: string;
  identifier: string;
  contact_name: string | null;
  service_id: string;
  service_name: string;
  professional_id: string;
  professional_name: string;
  start_dt: string;
  end_dt: string;
  status: string;
  payment_timing: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToAppointment(r: DbAppointmentRow): Appointment {
  return {
    id: r.id,
    clientId: r.client_id,
    contactId: r.contact_id,
    identifier: r.identifier,
    contactName: r.contact_name ?? undefined,
    serviceId: r.service_id,
    serviceName: r.service_name,
    professionalId: r.professional_id,
    professionalName: r.professional_name,
    startDateTime: new Date(r.start_dt).toISOString(),
    endDateTime: new Date(r.end_dt).toISOString(),
    status: (r.status as AppointmentStatus) || "solicitado",
    paymentTiming: (r.payment_timing as any) ?? null,
    paymentMethod: (r.payment_method as any) ?? null,
    notes: r.notes ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

// ---------------- Public API ----------------

export async function getServicesByClient(clientId: string): Promise<Service[]> {
  if (isDbEnabled()) {
    const res = await dbQuery<DbServiceRow>(
      `select * from nextia_services where client_id=$1 order by created_at desc`,
      [clientId]
    );
    return res.rows.map(rowToService);
  }
  const all = await readAllServicesJson();
  return all.filter((s) => s.clientId === clientId);
}

export async function createService(params: {
  clientId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  basePrice?: number | null;
  active?: boolean;
}): Promise<Service> {
  const now = nowIso();
  const service: Service = {
    id: createId("svc"),
    clientId: params.clientId,
    name: normStr(params.name),
    description: normOptStr(params.description),
    durationMinutes: Math.max(1, toInt(params.durationMinutes, 30)),
    basePrice: params.basePrice ?? null,
    active: params.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `insert into nextia_services (id, client_id, name, description, duration_minutes, base_price, active, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        service.id,
        service.clientId,
        service.name,
        service.description ?? null,
        service.durationMinutes,
        service.basePrice === null ? null : service.basePrice,
        service.active,
        service.createdAt,
        service.updatedAt,
      ]
    );
    return service;
  }

  const all = await readAllServicesJson();
  all.unshift(service);
  await writeAllServicesJson(all);
  return service;
}

export async function getProfessionalsByClient(clientId: string): Promise<Professional[]> {
  if (isDbEnabled()) {
    const res = await dbQuery<DbProfessionalRow>(
      `select * from nextia_professionals where client_id=$1 order by created_at desc`,
      [clientId]
    );
    return res.rows.map(rowToProfessional);
  }
  const all = await readAllProfessionalsJson();
  return all.filter((p) => p.clientId === clientId);
}

export async function createProfessional(params: {
  clientId: string;
  name: string;
  active?: boolean;
}): Promise<Professional> {
  const now = nowIso();
  const prof: Professional = {
    id: createId("pro"),
    clientId: params.clientId,
    name: normStr(params.name),
    active: params.active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `insert into nextia_professionals (id, client_id, name, active, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [prof.id, prof.clientId, prof.name, prof.active, prof.createdAt, prof.updatedAt]
    );
    return prof;
  }

  const all = await readAllProfessionalsJson();
  all.unshift(prof);
  await writeAllProfessionalsJson(all);
  return prof;
}

export async function getAppointmentsByClient(clientId: string): Promise<Appointment[]> {
  if (isDbEnabled()) {
    const res = await dbQuery<DbAppointmentRow>(
      `select * from nextia_appointments where client_id=$1 order by start_dt desc`,
      [clientId]
    );
    return res.rows.map(rowToAppointment);
  }
  const all = await readAllAppointmentsJson();
  return all.filter((a) => a.clientId === clientId);
}

export async function createAppointment(params: {
  clientId: string;
  contactId: string;
  identifier: string;
  contactName?: string;
  serviceId: string;
  serviceName: string;
  professionalId: string;
  professionalName: string;
  startDateTime: string;
  endDateTime?: string;
  paymentTiming?: PaymentTiming | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string;
}): Promise<Appointment> {
  const now = nowIso();
  const end = params.endDateTime
    ? params.endDateTime
    : addMinutesIso(params.startDateTime, 30);

  const apt: Appointment = {
    id: createId("apt"),
    clientId: params.clientId,
    contactId: params.contactId,
    identifier: normStr(params.identifier),
    contactName: normOptStr(params.contactName),
    serviceId: normStr(params.serviceId),
    serviceName: normStr(params.serviceName),
    professionalId: normStr(params.professionalId),
    professionalName: normStr(params.professionalName),
    startDateTime: params.startDateTime,
    endDateTime: end,
    status: "solicitado",
    paymentTiming: params.paymentTiming ?? null,
    paymentMethod: params.paymentMethod ?? null,
    notes: normOptStr(params.notes),
    createdAt: now,
    updatedAt: now,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `insert into nextia_appointments
        (id, client_id, contact_id, identifier, contact_name, service_id, service_name, professional_id, professional_name,
         start_dt, end_dt, status, payment_timing, payment_method, notes, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        apt.id,
        apt.clientId,
        apt.contactId,
        apt.identifier,
        apt.contactName ?? null,
        apt.serviceId,
        apt.serviceName,
        apt.professionalId,
        apt.professionalName,
        apt.startDateTime,
        apt.endDateTime,
        apt.status,
        apt.paymentTiming ?? null,
        apt.paymentMethod ?? null,
        apt.notes ?? null,
        apt.createdAt,
        apt.updatedAt,
      ]
    );
    return apt;
  }

  const all = await readAllAppointmentsJson();
  all.unshift(apt);
  await writeAllAppointmentsJson(all);
  return apt;
}

export async function patchAppointment(
  id: string,
  patch: Partial<
    Pick<
      Appointment,
      | "status"
      | "startDateTime"
      | "endDateTime"
      | "paymentTiming"
      | "paymentMethod"
      | "notes"
    >
  >
): Promise<Appointment | null> {
  if (!id) return null;

  if (isDbEnabled()) {
    // Fetch current
    const curRes = await dbQuery<DbAppointmentRow>(
      `select * from nextia_appointments where id=$1 limit 1`,
      [id]
    );
    const cur = curRes.rows[0];
    if (!cur) return null;
    const current = rowToAppointment(cur);

    const updated: Appointment = {
      ...current,
      status: (patch.status ?? current.status) as AppointmentStatus,
      startDateTime: patch.startDateTime ?? current.startDateTime,
      endDateTime: patch.endDateTime ?? current.endDateTime,
      paymentTiming:
        patch.paymentTiming === undefined ? current.paymentTiming : patch.paymentTiming,
      paymentMethod:
        patch.paymentMethod === undefined ? current.paymentMethod : patch.paymentMethod,
      notes: patch.notes === undefined ? current.notes : patch.notes,
      updatedAt: nowIso(),
    };

    await dbQuery(
      `update nextia_appointments set
         status=$2,
         start_dt=$3,
         end_dt=$4,
         payment_timing=$5,
         payment_method=$6,
         notes=$7,
         updated_at=$8
       where id=$1`,
      [
        updated.id,
        updated.status,
        updated.startDateTime,
        updated.endDateTime,
        updated.paymentTiming ?? null,
        updated.paymentMethod ?? null,
        updated.notes ?? null,
        updated.updatedAt,
      ]
    );
    return updated;
  }

  const all = await readAllAppointmentsJson();
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return null;

  const current = all[idx];
  const updated: Appointment = {
    ...current,
    status: (patch.status ?? current.status) as AppointmentStatus,
    startDateTime: patch.startDateTime ?? current.startDateTime,
    endDateTime: patch.endDateTime ?? current.endDateTime,
    paymentTiming:
      patch.paymentTiming === undefined ? current.paymentTiming : patch.paymentTiming,
    paymentMethod:
      patch.paymentMethod === undefined ? current.paymentMethod : patch.paymentMethod,
    notes: patch.notes === undefined ? current.notes : patch.notes,
    updatedAt: nowIso(),
  };
  all[idx] = updated;
  await writeAllAppointmentsJson(all);
  return updated;
}

export async function updateAppointmentStatus(
  clientId: string,
  appointmentId: string,
  status: string
): Promise<Appointment> {
  const allowed: AppointmentStatus[] = [
    "solicitado",
    "confirmado",
    "concluido",
    "cancelado",
    "no_show",
  ];

  if (!allowed.includes(status as AppointmentStatus)) {
    throw new Error(`Status invalido. Use: ${allowed.join(", ")}.`);
  }

  // Validate appointment belongs to client
  const list = await getAppointmentsByClient(clientId);
  const found = list.find((a) => a.id === appointmentId && a.clientId === clientId);
  if (!found) {
    const err: any = new Error("Agendamento não encontrado.");
    err.status = 404;
    throw err;
  }

  const updated = await patchAppointment(found.id, {
    status: status as AppointmentStatus,
  });

  if (!updated) {
    const err: any = new Error("Falha ao atualizar agendamento.");
    err.status = 500;
    throw err;
  }

  return updated;
}
