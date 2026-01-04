// src/lib/whatsappGroups.ts
// Cadastro local de grupos WhatsApp por cliente, com autorização explícita para campanhas.
// Importante: NÃO descobre grupos automaticamente via WhatsApp Web aqui. O objetivo é governança/segurança operacional.

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type WhatsAppGroupStatus = "active" | "paused";

export type WhatsAppGroup = {
  id: string; // id interno
  clientId: string;
  name: string;
  groupId: string; // ex: 1203...@g.us
  authorizedForCampaigns: boolean;
  status: WhatsAppGroupStatus;
  createdAt: string;
  updatedAt: string;
};

const groupsFile = getDataPath("whatsapp_groups.json");

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

function normalizeGroupId(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  // Aceita formatos clássicos:
  // - 1203630...@g.us
  // - 55219...-12345@g.us
  if (!v.includes("@g.us")) return "";
  return v;
}

export async function listGroupsByClient(clientId: string): Promise<WhatsAppGroup[]> {
  const all = await readJsonArray<WhatsAppGroup>(groupsFile);
  return all
    .filter((g) => g.clientId === clientId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAuthorizedGroupsByClient(clientId: string): Promise<WhatsAppGroup[]> {
  const all = await listGroupsByClient(clientId);
  return all.filter((g) => g.authorizedForCampaigns && g.status === "active");
}

export async function upsertGroup(input: {
  clientId: string;
  name: string;
  groupId: string;
  authorizedForCampaigns?: boolean;
  status?: WhatsAppGroupStatus;
}): Promise<WhatsAppGroup> {
  const clientId = String(input.clientId || "").trim();
  if (!clientId) throw new Error("clientId é obrigatório.");

  const name = String(input.name || "").trim();
  if (!name) throw new Error("name é obrigatório.");

  const groupId = normalizeGroupId(input.groupId);
  if (!groupId) throw new Error("groupId inválido. Deve terminar com @g.us.");

  const all = await readJsonArray<WhatsAppGroup>(groupsFile);
  const existingIdx = all.findIndex(
    (g) => g.clientId === clientId && g.groupId === groupId
  );

  const now = nowIso();

  if (existingIdx >= 0) {
    const prev = all[existingIdx];
    const updated: WhatsAppGroup = {
      ...prev,
      name,
      authorizedForCampaigns:
        typeof input.authorizedForCampaigns === "boolean"
          ? input.authorizedForCampaigns
          : prev.authorizedForCampaigns,
      status: input.status ?? prev.status,
      updatedAt: now,
    };
    all[existingIdx] = updated;
    await writeJsonArray(groupsFile, all);
    return updated;
  }

  const created: WhatsAppGroup = {
    id: createId("grp"),
    clientId,
    name,
    groupId,
    authorizedForCampaigns: Boolean(input.authorizedForCampaigns),
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  };

  all.push(created);
  await writeJsonArray(groupsFile, all);
  return created;
}

export async function setGroupAuthorization(params: {
  clientId: string;
  groupId: string;
  authorizedForCampaigns: boolean;
}): Promise<WhatsAppGroup | null> {
  const clientId = String(params.clientId || "").trim();
  const groupId = normalizeGroupId(params.groupId);
  if (!clientId || !groupId) return null;

  const all = await readJsonArray<WhatsAppGroup>(groupsFile);
  const idx = all.findIndex((g) => g.clientId === clientId && g.groupId === groupId);
  if (idx < 0) return null;

  const now = nowIso();
  const updated: WhatsAppGroup = {
    ...all[idx],
    authorizedForCampaigns: Boolean(params.authorizedForCampaigns),
    updatedAt: now,
  };
  all[idx] = updated;
  await writeJsonArray(groupsFile, all);
  return updated;
}

export async function setGroupStatus(params: {
  clientId: string;
  groupId: string;
  status: WhatsAppGroupStatus;
}): Promise<WhatsAppGroup | null> {
  const clientId = String(params.clientId || "").trim();
  const groupId = normalizeGroupId(params.groupId);
  if (!clientId || !groupId) return null;

  const all = await readJsonArray<WhatsAppGroup>(groupsFile);
  const idx = all.findIndex((g) => g.clientId === clientId && g.groupId === groupId);
  if (idx < 0) return null;

  const now = nowIso();
  const updated: WhatsAppGroup = {
    ...all[idx],
    status: params.status,
    updatedAt: now,
  };
  all[idx] = updated;
  await writeJsonArray(groupsFile, all);
  return updated;
}
