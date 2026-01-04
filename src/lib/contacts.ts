// src/lib/contacts.ts
// Camada de contatos usando jsonStore para leitura/escrita segura em JSON.

import {
  getDataPath,
  readJsonArray,
  writeJsonArray,
} from "./jsonStore";

export type Contact = {
  id: string;
  clientId: string;
  channel: "whatsapp" | string;
  identifier: string; // telefone ou identificador do canal
  name?: string;
  tags: string[];
  vip: boolean;
  optOutMarketing: boolean;
  blockedGlobal: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
  lastInteractionAt?: string;
  conversationSummary?: string;
};

const contactsFile = getDataPath("contacts.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

async function readAllContacts(): Promise<Contact[]> {
  const raw = await readJsonArray<Contact>(contactsFile);

  // Normaliza defaults para contatos antigos/incompletos
  return raw.map((c) => ({
    ...c,
    tags: Array.isArray((c as any).tags) ? (c as any).tags.filter((t: any) => typeof t === "string").map((t: string) => t.trim()).filter(Boolean) : [],
    vip: c.vip === true,
    optOutMarketing: c.optOutMarketing === true,
    blockedGlobal: c.blockedGlobal === true,
  }));
}

async function writeAllContacts(list: Contact[]): Promise<void> {
  await writeJsonArray<Contact>(contactsFile, list);
}

// ---------------------- CONSULTAS BÁSICAS ----------------------

export async function getContactsByClient(
  clientId: string
): Promise<Contact[]> {
  const all = await readAllContacts();
  return all
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => {
      const an = a.name || a.identifier;
      const bn = b.name || b.identifier;
      return an > bn ? 1 : -1;
    });
}

export async function getContactById(
  clientId: string,
  contactId: string
): Promise<Contact | null> {
  const all = await readAllContacts();
  const found = all.find(
    (c) => c.clientId === clientId && c.id === contactId
  );
  return found || null;
}

export async function getContactByIdentifier(
  clientId: string,
  identifier: string
): Promise<Contact | null> {
  const normalized = String(identifier || "").trim();
  if (!normalized) return null;

  const all = await readAllContacts();
  const found = all.find(
    (c) =>
      c.clientId === clientId &&
      c.identifier === normalized
  );
  return found || null;
}

// ---------------------- UPSERT A PARTIR DE WEBHOOK ----------------------

export async function upsertContactFromInbound(params: {
  clientId: string;
  channel: "whatsapp" | string;
  identifier: string;
  name?: string;
  lastMessage?: string;
  interactionDate?: string; // opcional – se não vier, usamos now
}): Promise<Contact> {
  const all = await readAllContacts();

  const now = new Date().toISOString();
  const interactionAt = params.interactionDate || now;
  const identifier = String(params.identifier || "").trim();
  const channel = (params.channel || "whatsapp") as string;

  if (!identifier) {
    throw new Error("identifier é obrigatório em upsertContactFromInbound");
  }

  const existingIndex = all.findIndex(
    (c) =>
      c.clientId === params.clientId &&
      c.identifier === identifier
  );

  if (existingIndex >= 0) {
    const existing = all[existingIndex];

    const updated: Contact = {
      ...existing,
      // atualiza nome se veio algum e o existente estiver vazio
      name:
        params.name && params.name.trim()
          ? params.name.trim()
          : existing.name,
      channel: (existing.channel as any) || channel,
      lastMessage: params.lastMessage ?? existing.lastMessage,
      lastInteractionAt: interactionAt,
      updatedAt: now,
    };

    all[existingIndex] = updated;
    await writeAllContacts(all);
    return updated;
  }

  const contact: Contact = {
    id: createId("ct"),
    clientId: params.clientId,
    channel,
    identifier,
    name: params.name?.trim() || undefined,
    tags: [],
    vip: false,
    optOutMarketing: false,
    blockedGlobal: false,
    createdAt: now,
    updatedAt: now,
    lastMessage: params.lastMessage,
    lastInteractionAt: interactionAt,
  };

  all.push(contact);
  await writeAllContacts(all);
  return contact;
}

// ---------------------- ATUALIZAÇÃO DE FLAGS ----------------------

export async function updateContactFlags(params: {
  clientId: string;
  contactId: string;
  vip?: boolean;
  optOutMarketing?: boolean;
  blockedGlobal?: boolean;
}): Promise<Contact | null> {
  const all = await readAllContacts();
  const idx = all.findIndex(
    (c) =>
      c.clientId === params.clientId &&
      c.id === params.contactId
  );
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const current = all[idx];

  const updated: Contact = {
    ...current,
    vip:
      typeof params.vip === "boolean" ? params.vip : current.vip,
    optOutMarketing:
      typeof params.optOutMarketing === "boolean"
        ? params.optOutMarketing
        : current.optOutMarketing,
    blockedGlobal:
      typeof params.blockedGlobal === "boolean"
        ? params.blockedGlobal
        : current.blockedGlobal,
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllContacts(all);
  return updated;
}

// ---------------------- RESUMO DE CONVERSA ----------------------

async function internalUpdateContactSummary(
  clientId: string,
  contactId: string,
  conversationSummary: string
): Promise<Contact | null> {
  const all = await readAllContacts();
  const idx = all.findIndex(
    (c) =>
      c.clientId === clientId && c.id === contactId
  );
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const updated: Contact = {
    ...all[idx],
    conversationSummary: conversationSummary.trim(),
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllContacts(all);
  return updated;
}

/**
 * Nome genérico para ser usado por rotas existentes
 * (caso alguma já importe updateContactSummary).
 */
export async function updateContactSummary(
  clientId: string,
  contactId: string,
  conversationSummary: string
): Promise<Contact | null> {
  return internalUpdateContactSummary(
    clientId,
    contactId,
    conversationSummary
  );
}

/**
 * Nome alternativo mais explícito para novas rotas.
 */
export async function setContactConversationSummary(
  clientId: string,
  contactId: string,
  conversationSummary: string
): Promise<Contact | null> {
  return internalUpdateContactSummary(
    clientId,
    contactId,
    conversationSummary
  );
}

/**
 * Atualização em lote de resumos de conversa.
 * Útil para endpoints que geram vários resumos de uma vez.
 */
export async function bulkUpdateContactSummaries(
  clientId: string,
  items: { contactId: string; conversationSummary: string }[]
): Promise<Contact[]> {
  if (!items.length) {
    return getContactsByClient(clientId);
  }

  const all = await readAllContacts();
  const now = new Date().toISOString();

  const summariesMap = new Map<string, string>();
  for (const item of items) {
    const cid = String(item.contactId || "").trim();
    if (!cid || !item.conversationSummary) continue;
    summariesMap.set(cid, item.conversationSummary.trim());
  }

  const updatedList: Contact[] = all.map((c) => {
    if (c.clientId !== clientId) return c;
    const summary = summariesMap.get(c.id);
    if (!summary) return c;

    return {
      ...c,
      conversationSummary: summary,
      updatedAt: now,
    };
  });

  await writeAllContacts(updatedList);
  return updatedList.filter((c) => c.clientId === clientId);
}

// ---------------------- MOCK DE RESUMO AUTOMÁTICO ----------------------

function buildMockSummaryFromContact(c: Contact): string {
  const nome =
    c.name && c.name.trim()
      ? c.name.trim()
      : "sem nome definido";

  const tipoCliente = c.vip
    ? "cliente VIP"
    : "cliente normal (não VIP)";

  const marketing = c.optOutMarketing
    ? "Não aceita receber campanhas de marketing."
    : "Aceita receber campanhas de marketing.";

  const bloqueio = c.blockedGlobal
    ? "Atualmente está bloqueado para atendimento global."
    : "Está liberado para atendimento.";

  let ultimaInteracao = "Sem registro de última interação recente.";
  if (c.lastInteractionAt) {
    try {
      const dt = new Date(c.lastInteractionAt);
      const fmt = dt.toLocaleString("pt-BR");
      ultimaInteracao = `Última interação registrada em ${fmt}.`;
    } catch {
      ultimaInteracao = `Última interação registrada em ${c.lastInteractionAt}.`;
    }
  }

  const ultimaMensagem = c.lastMessage
    ? `Última mensagem registrada: "${c.lastMessage}".`
    : "";

  return [
    `Contato de WhatsApp ${c.identifier}, identificado como ${nome}.`,
    `Marcado como ${tipoCliente}.`,
    marketing,
    bloqueio,
    ultimaInteracao,
    ultimaMensagem,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Função usada pelo endpoint /contacts/summarize.
 * Gera resumos "mock" baseados apenas nos dados do contato,
 * grava em conversationSummary e devolve a lista atualizada.
 */
export async function generateMockConversationSummariesByClient(
  clientId: string
): Promise<Contact[]> {
  const contacts = await getContactsByClient(clientId);

  const items = contacts.map((c) => ({
    contactId: c.id,
    conversationSummary: buildMockSummaryFromContact(c),
  }));

  return bulkUpdateContactSummaries(clientId, items);
}

// ---------------------- COMPAT: endpoints importing legacy names ----------------------

export async function patchContact(
  contactId: string,
  patch: Partial<Pick<Contact, "name" | "vip" | "optOutMarketing" | "blockedGlobal">>
): Promise<Contact | null> {
  const all = await (async () => {
    // Reuse internal reader (kept private above)
    return readAllContacts();
  })();

  const idx = all.findIndex((c) => c.id === contactId);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const current = all[idx];

  const updated: Contact = {
    ...current,
    name: typeof patch.name === "string" ? (patch.name.trim() || undefined) : current.name,
    vip: typeof patch.vip === "boolean" ? patch.vip : current.vip,
    optOutMarketing:
      typeof patch.optOutMarketing === "boolean" ? patch.optOutMarketing : current.optOutMarketing,
    blockedGlobal:
      typeof patch.blockedGlobal === "boolean" ? patch.blockedGlobal : current.blockedGlobal,
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllContacts(all);
  return updated;
}

export async function setContactOptOut(
  contactId: string,
  optOutMarketing: boolean
): Promise<Contact | null> {
  return patchContact(contactId, { optOutMarketing });
}


export async function getTagsByClient(clientId: string): Promise<string[]> {
  const all = await readAllContacts();
  const tags = new Set<string>();
  for (const c of all) {
    if (c.clientId !== clientId) continue;
    const arr = Array.isArray((c as any).tags) ? (c as any).tags : [];
    for (const t of arr) {
      if (typeof t !== "string") continue;
      const s = t.trim();
      if (s) tags.add(s);
    }
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

export async function setContactTags(
  clientId: string,
  contactId: string,
  tags: string[]
): Promise<Contact | null> {
  const all = await readAllContacts();
  const idx = all.findIndex((c) => c.id === contactId && c.clientId === clientId);
  if (idx < 0) return null;

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(tags) ? tags : []) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }

  const now = new Date().toISOString();
  const updated: Contact = {
    ...all[idx],
    tags: unique,
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllContacts(all);
  return updated;
}
