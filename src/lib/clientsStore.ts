// src/lib/clientsStore.ts
import { promises as fs } from "fs";
import path from "path";

export type ClientStatus = "active" | "inactive";

export type BillingStatus = "active" | "past_due" | "suspended" | "trial";

export type ClientBilling = {
  status: BillingStatus;
  dueDate?: string;      // ISO date (YYYY-MM-DD) or ISO datetime
  graceUntil?: string;   // ISO date/datetime
  lastPaymentAt?: string;
  notes?: string;
};

export type ClientAccess = {
  isBlocked?: boolean;
  blockReason?: "non_payment" | "manual" | "fraud" | "other";
  blockedAt?: string;
  blockedBy?: string;
};

export type ClientPlan = {
  id?: string; // "free" | "starter" | "pro" | "enterprise"
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
};

export type ClientWhatsappNumber = {
  id: string;
  phoneNumber: string;
  label?: string;
  isDefault?: boolean;
};

export type ClientRecord = {
  id: string; // clientId (slug)
  name: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  segment?: string;
  whatsappNumbers?: ClientWhatsappNumber[];
  billing?: ClientBilling;
  access?: ClientAccess;
  plan?: ClientPlan;
};

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "clients.json");

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(FILE_PATH);
  } catch {
    await fs.writeFile(FILE_PATH, "[]", "utf-8");
  }
}

export function normalizeClientId(input: string) {
  const id = (input || "").trim();
  if (!id) throw new Error("clientId é obrigatório.");
  // allow letters, numbers, underscore and dash
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(id)) {
    throw new Error(
      "clientId inválido. Use apenas letras, números, '_' ou '-' (2-64 caracteres)."
    );
  }
  return id;
}

export async function listClients(): Promise<ClientRecord[]> {
  await ensureDataFile();
  const raw = await fs.readFile(FILE_PATH, "utf-8");
  let arr: unknown[] = [];
  try {
    arr = JSON.parse(raw);
  } catch {
    arr = [];
  }
  return Array.isArray(arr) ? (arr as ClientRecord[]) : [];
}

export async function upsertClient(client: ClientRecord) {
  const clients = await listClients();
  const idx = clients.findIndex((c) => c.id === client.id);
  if (idx >= 0) clients[idx] = client;
  else clients.push(client);
  await fs.writeFile(FILE_PATH, JSON.stringify(clients, null, 2), "utf-8");
}

export async function getClient(clientId: string): Promise<ClientRecord | null> {
  const clients = await listClients();
  return clients.find((c) => c.id === clientId) || null;
}

export function effectiveBillingStatus(client: ClientRecord): BillingStatus {
  const b = client.billing;
  if (!b) return "active";

  // Hard block wins
  if (client.access?.isBlocked) return "suspended";

  const due = b.dueDate ? new Date(b.dueDate) : null;
  const grace = b.graceUntil ? new Date(b.graceUntil) : null;

  if (due) {
    const now = new Date();
    const cutoff = grace ?? due;
    if (now.getTime() > cutoff.getTime()) return "suspended";
    if (now.getTime() > due.getTime()) return "past_due";
  }

  return b.status || "active";
}

export async function getClientOrThrow(
  clientId: string
): Promise<ClientRecord> {
  const id = normalizeClientId(clientId);
  const client = await getClient(id);
  if (!client) {
    const err = new Error("Cliente não encontrado.");
    // @ts-expect-error: dynamic import JSON store type mismatch
    err.statusCode = 404;
    throw err;
  }
  return client;
}

export async function assertClientActiveOrThrow(clientId: string) {
  const client = await getClientOrThrow(clientId);

  // "inactive" == inadimplente / suspenso operacionalmente
  if (client.status !== "active") {
    const err = new Error("Cliente inadimplente ou inativo.");
    // @ts-expect-error: dynamic import JSON store type mismatch
    err.statusCode = 403;
    throw err;
  }

  const bill = effectiveBillingStatus(client);
  if (bill === "suspended") {
    const err = new Error("Cliente inadimplente (acesso suspenso).");
    // @ts-expect-error: dynamic import JSON store type mismatch
    err.statusCode = 403;
    throw err;
  }

  return client;
}
/**
 * Compat: alguns módulos legados esperam um "registry" explícito.
 * Aqui o registry é a lista de clientes persistida em data/clients.json.
 */
export async function getClientsRegistry(): Promise<ClientRecord[]> {
  return listClients();
}

export async function setClientsRegistry(clients: ClientRecord[]): Promise<void> {
  await ensureDataFile();
  await fs.writeFile(FILE_PATH, JSON.stringify(clients, null, 2), "utf-8");
}
