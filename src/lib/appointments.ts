// src/lib/appointments.ts
import { promises as fs } from "fs";
import path from "path";

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
  servicesIds: string[];
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

export type PaymentTiming = "antecipado" | "no_local" | null;

export type PaymentMethod =
  | "pix"
  | "dinheiro"
  | "cartao_credito"
  | "cartao_debito"
  | null;

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
  startDateTime: string;
  endDateTime: string;
  status: AppointmentStatus;
  paymentTiming?: PaymentTiming | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const servicesFile = path.join(dataDir, "services.json");
const professionalsFile = path.join(dataDir, "professionals.json");
const appointmentsFile = path.join(dataDir, "appointments.json");

async function ensureFiles() {
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }

  try {
    await fs.access(servicesFile);
  } catch {
    await fs.writeFile(servicesFile, "[]", "utf-8");
  }

  try {
    await fs.access(professionalsFile);
  } catch {
    await fs.writeFile(professionalsFile, "[]", "utf-8");
  }

  try {
    await fs.access(appointmentsFile);
  } catch {
    await fs.writeFile(appointmentsFile, "[]", "utf-8");
  }
}

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

// -------------------- SERVICES --------------------

async function readAllServices(): Promise<Service[]> {
  await ensureFiles();
  const raw = await fs.readFile(servicesFile, "utf-8");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => ({
      ...s,
      durationMinutes: Number(s.durationMinutes) || 30,
      basePrice:
        typeof s.basePrice === "number" ? s.basePrice : null,
      active: s.active !== false,
    })) as Service[];
  } catch {
    return [];
  }
}

async function writeAllServices(list: Service[]): Promise<void> {
  await ensureFiles();
  await fs.writeFile(servicesFile, JSON.stringify(list, null, 2), "utf-8");
}

export async function getServicesByClient(
  clientId: string
): Promise<Service[]> {
  const all = await readAllServices();
  return all
    .filter((s) => s.clientId === clientId)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

export async function createService(params: {
  clientId: string;
  name: string;
  description?: string;
  durationMinutes?: number;
  basePrice?: number | null;
}): Promise<Service> {
  const all = await readAllServices();
  const now = new Date().toISOString();

  const service: Service = {
    id: createId("svc"),
    clientId: params.clientId,
    name: params.name.trim(),
    description: params.description?.trim() || undefined,
    durationMinutes: params.durationMinutes && params.durationMinutes > 0
      ? Math.floor(params.durationMinutes)
      : 30,
    basePrice:
      typeof params.basePrice === "number" ? params.basePrice : null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  all.push(service);
  await writeAllServices(all);
  return service;
}

// -------------------- PROFESSIONALS --------------------

async function readAllProfessionals(): Promise<Professional[]> {
  await ensureFiles();
  const raw = await fs.readFile(professionalsFile, "utf-8");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((p) => ({
      ...p,
      servicesIds: Array.isArray(p.servicesIds) ? p.servicesIds : [],
      active: p.active !== false,
    })) as Professional[];
  } catch {
    return [];
  }
}

async function writeAllProfessionals(list: Professional[]): Promise<void> {
  await ensureFiles();
  await fs.writeFile(
    professionalsFile,
    JSON.stringify(list, null, 2),
    "utf-8"
  );
}

export async function getProfessionalsByClient(
  clientId: string
): Promise<Professional[]> {
  const all = await readAllProfessionals();
  return all
    .filter((p) => p.clientId === clientId)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

export async function createProfessional(params: {
  clientId: string;
  name: string;
}): Promise<Professional> {
  const all = await readAllProfessionals();
  const now = new Date().toISOString();

  const professional: Professional = {
    id: createId("pro"),
    clientId: params.clientId,
    name: params.name.trim(),
    servicesIds: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  all.push(professional);
  await writeAllProfessionals(all);
  return professional;
}

// -------------------- APPOINTMENTS --------------------

async function readAllAppointments(): Promise<Appointment[]> {
  await ensureFiles();
  const raw = await fs.readFile(appointmentsFile, "utf-8");
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed)) return [];
    return parsed as Appointment[];
  } catch {
    return [];
  }
}

async function writeAllAppointments(list: Appointment[]): Promise<void> {
  await ensureFiles();
  await fs.writeFile(
    appointmentsFile,
    JSON.stringify(list, null, 2),
    "utf-8"
  );
}

export async function getAppointmentsByClient(
  clientId: string
): Promise<Appointment[]> {
  const all = await readAllAppointments();
  return all
    .filter((a) => a.clientId === clientId)
    .sort((a, b) => (a.startDateTime > b.startDateTime ? 1 : -1));
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
  const all = await readAllAppointments();
  const now = new Date().toISOString();

  const end =
    params.endDateTime && params.endDateTime.trim().length > 0
      ? params.endDateTime
      : params.startDateTime;

  const appointment: Appointment = {
    id: createId("apt"),
    clientId: params.clientId,
    contactId: params.contactId,
    identifier: params.identifier,
    contactName: params.contactName,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    professionalId: params.professionalId,
    professionalName: params.professionalName,
    startDateTime: params.startDateTime,
    endDateTime: end,
    status: "solicitado",
    paymentTiming: params.paymentTiming ?? null,
    paymentMethod: params.paymentMethod ?? null,
    notes: params.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  all.push(appointment);
  await writeAllAppointments(all);
  return appointment;
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
  const all = await readAllAppointments();
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return null;

  const updated: Appointment = {
    ...all[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  all[idx] = updated;
  await writeAllAppointments(all);
  return updated;
}

// -------------------- COMPAT: status update used by route handlers --------------------

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
    throw new Error(
      `Status invalido. Use: ${allowed.join(", ")}.`
    );
  }

  const all = await readAllAppointments();
  const found = all.find(
    (a) => a.id === appointmentId && a.clientId === clientId
  );

  if (!found) {
    const err: any = new Error("Agendamento nao encontrado.");
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
