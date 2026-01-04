// src/lib/clients.ts
export const runtime = "nodejs";

import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";
import { isDbEnabled } from "@/lib/db";
import {
  dbGetClientById,
  dbInsertClient,
  dbListClients,
  dbUpdateClient,
  type DbClientRow,
} from "@/lib/clientsDb";
import { detectAndValidateDocumento, digitsOnly } from "@/lib/validators/brDocument";

export type ClientStatus = "active" | "inactive";

export type ClientWhatsappNumber = {
  id: string;
  phoneNumber: string;
  label?: string;
  isDefault?: boolean;
};

export type ClientBilling = {
  provider?: "asaas" | "manual";
  customerId?: string;
  subscriptionId?: string;
};

export type ClientAccess = {
  allowHandoff?: boolean;
  allowCampaigns?: boolean;
  allowedIps?: string[];
  features?: string[];
};

export type ClientPlan = {
  tier?: "free" | "starter" | "pro" | "enterprise";
  maxContacts?: number;
  maxMessagesPerDay?: number;
};

export type ClientProfile = {
  tipoPessoa?: "PF" | "PJ";
  documento?: string; // CPF ou CNPJ (digits-only)
  documentoTipo?: "CPF" | "CNPJ";
  documentoValidado?: boolean;

  razaoSocial?: string;
  nomeFantasia?: string;

  inscricaoEstadual?: string;
  isentoIE?: boolean;
  inscricaoMunicipal?: string;

  emailPrincipal?: string;
  emailsSecundarios?: string[];

  telefonePrincipal?: string;
  telefonesSecundarios?: string[];

  responsavelNome?: string;
  responsavelCargo?: string;

  endereco?: {
    cep?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    referencia?: string;
  };

  categoria?: string;
  instagram?: string;
  site?: string;
  urlCardapio?: string;

  observacoesOperacionais?: string;
};

export type ClientRecord = {
  id: string; // slug único (clientId)
  name: string;
  status: ClientStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  segment?: string;
  whatsappNumbers?: ClientWhatsappNumber[];
  billing?: ClientBilling;
  access?: ClientAccess;
  plan?: ClientPlan;
  profile?: ClientProfile;
};

const CLIENTS_FILE = getDataPath("clients.json");

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email?: unknown): string | undefined {
  const s = typeof email === "string" ? email.trim().toLowerCase() : "";
  return s ? s : undefined;
}

function normalizePhone(phone?: unknown): string | undefined {
  const s = typeof phone === "string" ? phone.trim() : "";
  if (!s) return undefined;
  // Store as digits-only for consistency (Brasil)
  const d = digitsOnly(s);
  return d || undefined;
}

function validateProfile(profile: ClientProfile | undefined): ClientProfile | undefined {
  if (!profile) return undefined;

  const next: ClientProfile = { ...profile };

  // Email normalization
  next.emailPrincipal = normalizeEmail(next.emailPrincipal);
  if (Array.isArray(next.emailsSecundarios)) {
    next.emailsSecundarios = next.emailsSecundarios
      .map((e) => normalizeEmail(e))
      .filter(Boolean) as string[];
    if (next.emailsSecundarios.length === 0) delete next.emailsSecundarios;
  }

  // Phone normalization
  next.telefonePrincipal = normalizePhone(next.telefonePrincipal);
  if (Array.isArray(next.telefonesSecundarios)) {
    next.telefonesSecundarios = next.telefonesSecundarios
      .map((p) => normalizePhone(p))
      .filter(Boolean) as string[];
    if (next.telefonesSecundarios.length === 0) delete next.telefonesSecundarios;
  }

  // Documento (CPF/CNPJ) detection + validation
  if (typeof next.documento === "string" && next.documento.trim()) {
    const det = detectAndValidateDocumento(next.documento);
    if (!det) {
      throw new Error("Documento inválido: vazio.");
    }
    next.documento = det.digits;
    next.documentoTipo = det.type;
    next.documentoValidado = det.isValid;
    if (!det.isValid) {
      throw new Error("Documento inválido: CPF/CNPJ não passou na validação.");
    }
    // Infer tipoPessoa if missing
    if (!next.tipoPessoa) next.tipoPessoa = det.type === "CPF" ? "PF" : "PJ";
  }

  // CEP normalization
  if (next.endereco?.cep) {
    const cep = digitsOnly(next.endereco.cep);
    next.endereco.cep = cep || next.endereco.cep;
  }

  return next;
}

function normalizeClientRecord(raw: any): ClientRecord {
  if (!raw || typeof raw !== "object") throw new Error("Cliente inválido.");

  const id = String(raw.id || "").trim();
  const name = String(raw.name || "").trim();
  if (!id) throw new Error("id do cliente é obrigatório.");
  if (!name) throw new Error("name do cliente é obrigatório.");

  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : nowIso();
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : createdAt;

  const status: ClientStatus = raw.status === "inactive" ? "inactive" : "active";

  const whatsappNumbers = Array.isArray(raw.whatsappNumbers)
    ? raw.whatsappNumbers.filter((n: any) => n && n.id && n.phoneNumber)
    : undefined;

  const segment = typeof raw.segment === "string" ? raw.segment : undefined;

  const billing = raw.billing && typeof raw.billing === "object" ? raw.billing : undefined;
  const access = raw.access && typeof raw.access === "object" ? raw.access : undefined;
  const plan = raw.plan && typeof raw.plan === "object" ? raw.plan : undefined;

  const profile =
    raw.profile && typeof raw.profile === "object" ? validateProfile(raw.profile) : undefined;

  return {
    id,
    name,
    status,
    createdAt,
    updatedAt,
    segment,
    whatsappNumbers,
    billing,
    access,
    plan,
    profile,
  };
}

function toDbRow(client: ClientRecord): DbClientRow {
  return {
    id: client.id,
    name: client.name,
    status: client.status,
    segment: client.segment ?? null,
    created_at: client.createdAt,
    updated_at: client.updatedAt,
    whatsapp_numbers: client.whatsappNumbers ?? null,
    billing: client.billing ?? null,
    access: client.access ?? null,
    plan: client.plan ?? null,
    profile: client.profile ?? null,
  };
}

function fromDbRow(row: DbClientRow): ClientRecord {
  return normalizeClientRecord({
    id: row.id,
    name: row.name,
    status: row.status,
    segment: row.segment ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    whatsappNumbers: row.whatsapp_numbers ?? undefined,
    billing: row.billing ?? undefined,
    access: row.access ?? undefined,
    plan: row.plan ?? undefined,
    profile: row.profile ?? undefined,
  });
}

async function loadClientsJson(): Promise<ClientRecord[]> {
  const file = CLIENTS_FILE;
  const raw = await readJsonValue<any[]>(file, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeClientRecord);
}

async function saveClientsJson(clients: ClientRecord[]): Promise<void> {
  await writeJsonValue(CLIENTS_FILE, clients);
}

export async function listClients(): Promise<ClientRecord[]> {
  if (isDbEnabled()) {
    const rows = await dbListClients();
    return rows.map(fromDbRow);
  }
  return loadClientsJson();
}

export async function getClientById(clientId: string): Promise<ClientRecord | null> {
  const id = String(clientId || "").trim();
  if (!id) return null;

  if (isDbEnabled()) {
    const row = await dbGetClientById(id);
    return row ? fromDbRow(row) : null;
  }

  const list = await loadClientsJson();
  return list.find((c) => c.id === id) || null;
}

export async function createClient(
  client: Partial<ClientRecord>,
  actor: string = "operator_generic"
): Promise<ClientRecord> {
  const id = String(client?.id || "").trim();
  if (!id) throw new Error("id do cliente é obrigatório.");
  const name = String(client?.name || "").trim();
  if (!name) throw new Error("name do cliente é obrigatório.");

  const now = nowIso();

  const record = normalizeClientRecord({
    id,
    name,
    status: client?.status || "active",
    createdAt: now,
    updatedAt: now,
    segment: client?.segment,
    whatsappNumbers: client?.whatsappNumbers,
    billing: client?.billing,
    access: client?.access,
    plan: client?.plan,
    profile: client?.profile,
  });

  if (isDbEnabled()) {
    const existing = await dbGetClientById(record.id);
    if (existing) throw new Error("Já existe cliente com esse id.");
    await dbInsertClient(toDbRow(record) as any, actor);
    return record;
  }

  const list = await loadClientsJson();
  if (list.some((c) => c.id === record.id)) throw new Error("Já existe cliente com esse id.");
  list.push(record);
  await saveClientsJson(list);
  return record;
}

export async function updateClient(
  clientId: string,
  patch: Partial<ClientRecord>,
  actor: string = "operator_generic"
): Promise<ClientRecord> {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("id inválido.");

  if (isDbEnabled()) {
    const current = await dbGetClientById(id);
    if (!current) throw new Error("Cliente não encontrado.");

    // Merge patch on app-level shape
    const merged = normalizeClientRecord({
      ...fromDbRow(current),
      ...patch,
      id,
      updatedAt: nowIso(),
      // profile merged shallowly
      profile: patch.profile ? { ...(fromDbRow(current).profile || {}), ...patch.profile } : fromDbRow(current).profile,
    });

    const updated = await dbUpdateClient(id, toDbRow(merged) as any, actor);
    if (!updated) throw new Error("Cliente não encontrado.");
    return merged;
  }

  const list = await loadClientsJson();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error("Cliente não encontrado.");

  const merged = normalizeClientRecord({
    ...list[idx],
    ...patch,
    id,
    updatedAt: nowIso(),
    profile: patch.profile ? { ...(list[idx].profile || {}), ...patch.profile } : list[idx].profile,
  });

  list[idx] = merged;
  await saveClientsJson(list);
  return merged;
}
