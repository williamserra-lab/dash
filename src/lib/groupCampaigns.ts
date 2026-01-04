// src/lib/groupCampaigns.ts
// Campanhas para grupos WhatsApp com governança:
// - grupos precisam estar autorizados (checado no handler de API antes de enviar)
// - guardrails de volume/ritmo no momento do enfileiramento (outbox)

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";
import { upsertGroupRunItemQueued } from "@/lib/groupCampaignRunItems";

export type GroupCampaignStatus = "rascunho" | "simulada" | "disparada" | "pausada" | "cancelada";

export type GroupCampaignPaceProfile = "safe" | "balanced" | "aggressive";

export type GroupCampaign = {
  id: string;
  clientId: string;
  name: string;
  message: string;
  status: GroupCampaignStatus;
  paceProfile: GroupCampaignPaceProfile;
  // grupos selecionados (IDs @g.us)
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
  lastSimulatedAt?: string | null;
  lastSentAt?: string | null;
};

export type GroupCampaignSendStatus = "simulado" | "agendado" | "enfileirado" | "enviado" | "erro";

export type GroupCampaignSend = {
  id: string;
  groupCampaignId: string;
  clientId: string;
  groupId: string;
  participantJid?: string | null;
  status: GroupCampaignSendStatus;
  notBefore?: string | null;
  createdAt: string;
};

const campaignsFile = getDataPath("group_campaigns.json");
const sendsFile = getDataPath("group_campaign_sends.json");

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
  if (!v.includes("@g.us")) return "";
  return v;
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(v);
  return Math.max(min, Math.min(max, n));
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addSeconds(baseMs: number, sec: number): string {
  return new Date(baseMs + sec * 1000).toISOString();
}

export function getGroupGuardrails(profile: GroupCampaignPaceProfile): {
  // intervalo em segundos entre envios de grupos
  perSendMinSec: number;
  perSendMaxSec: number;
  // pausa a cada N envios
  pauseEvery: number;
  pauseMinSec: number;
  pauseMaxSec: number;
  // limite por campanha (grupos)
  maxGroupsPerCampaign: number;
} {
  // Defaults (SAFE)
  if (profile === "aggressive") {
    return {
      perSendMinSec: 30,
      perSendMaxSec: 60,
      pauseEvery: 10,
      pauseMinSec: 120,
      pauseMaxSec: 240,
      maxGroupsPerCampaign: 80,
    };
  }
  if (profile === "balanced") {
    return {
      perSendMinSec: 60,
      perSendMaxSec: 120,
      pauseEvery: 10,
      pauseMinSec: 240,
      pauseMaxSec: 480,
      maxGroupsPerCampaign: 50,
    };
  }
  return {
    perSendMinSec: 90,
    perSendMaxSec: 180,
    pauseEvery: 10,
    pauseMinSec: 300,
    pauseMaxSec: 600,
    maxGroupsPerCampaign: 30,
  };
}

function buildNotBeforeSchedule(count: number, profile: GroupCampaignPaceProfile): string[] {
  const g = getGroupGuardrails(profile);
  const base = Date.now();
  let cursor = 0;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const step = randInt(g.perSendMinSec, g.perSendMaxSec);
    cursor += step;
    // pausa programada
    if (g.pauseEvery > 0 && (i + 1) % g.pauseEvery === 0 && i + 1 < count) {
      cursor += randInt(g.pauseMinSec, g.pauseMaxSec);
    }
    out.push(addSeconds(base, cursor));
  }
  return out;
}

async function readAllCampaigns(): Promise<GroupCampaign[]> {
  const raw = await readJsonArray<GroupCampaign>(campaignsFile);
  return raw.map((c) => ({
    ...c,
    groupIds: Array.isArray(c.groupIds) ? c.groupIds.filter(Boolean) : [],
    paceProfile: (c.paceProfile || "safe") as GroupCampaignPaceProfile,
  }));
}

async function writeAllCampaigns(all: GroupCampaign[]): Promise<void> {
  await writeJsonArray(campaignsFile, all);
}

async function readAllSends(): Promise<GroupCampaignSend[]> {
  return await readJsonArray<GroupCampaignSend>(sendsFile);
}

async function writeAllSends(all: GroupCampaignSend[]): Promise<void> {
  await writeJsonArray(sendsFile, all);
}

export async function listGroupCampaigns(clientId: string): Promise<GroupCampaign[]> {
  const all = await readAllCampaigns();
  return all
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getGroupCampaignById(clientId: string, campaignId: string): Promise<GroupCampaign | null> {
  const all = await readAllCampaigns();
  return all.find((c) => c.clientId === clientId && c.id === campaignId) ?? null;
}

export async function createGroupCampaign(input: {
  clientId: string;
  name: string;
  message: string;
  groupIds: string[];
  paceProfile?: GroupCampaignPaceProfile;
}): Promise<GroupCampaign> {
  const clientId = String(input.clientId || "").trim();
  if (!clientId) throw new Error("clientId é obrigatório.");

  const name = String(input.name || "").trim();
  if (!name) throw new Error("name é obrigatório.");

  const message = String(input.message || "").trim();
  if (!message) throw new Error("message é obrigatório.");

  const groupIds = (input.groupIds || []).map(normalizeGroupId).filter(Boolean);
  if (!groupIds.length) throw new Error("Selecione ao menos 1 grupo.");

  const profile = (input.paceProfile || "safe") as GroupCampaignPaceProfile;
  const guard = getGroupGuardrails(profile);
  if (groupIds.length > guard.maxGroupsPerCampaign) {
    throw new Error(`Limite excedido: máximo ${guard.maxGroupsPerCampaign} grupos por campanha (perfil ${profile}).`);
  }

  const now = nowIso();
  const campaign: GroupCampaign = {
    id: createId("gcamp"),
    clientId,
    name,
    message,
    status: "rascunho",
    paceProfile: profile,
    groupIds,
    createdAt: now,
    updatedAt: now,
    lastSimulatedAt: null,
    lastSentAt: null,
  };

  const all = await readAllCampaigns();
  all.push(campaign);
  await writeAllCampaigns(all);
  return campaign;
}

export async function simulateGroupCampaign(clientId: string, campaignId: string): Promise<GroupCampaign | null> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) return null;

  const now = nowIso();
  const updated: GroupCampaign = {
    ...all[idx],
    status: "simulada",
    lastSimulatedAt: now,
    updatedAt: now,
  };
  all[idx] = updated;
  await writeAllCampaigns(all);

  // registra envios simulados (um por grupo)
  const sends = await readAllSends();
  for (const gid of updated.groupIds) {
    sends.push({
      id: createId("gsend"),
      groupCampaignId: updated.id,
      clientId: updated.clientId,
      groupId: gid,
      status: "simulado",
      createdAt: now,
    });
  }
  await writeAllSends(sends);

  return updated;
}

export async function enqueueGroupCampaignToOutbox(params: {
  clientId: string;
  campaignId: string;
  runId?: string | null;
  // grupos já validados/autorizados
  groupIds: string[];
  message: string;
  paceProfile: GroupCampaignPaceProfile;
}): Promise<{ enqueued: number }> {
  const clientId = String(params.clientId || "").trim();
  const campaignId = String(params.campaignId || "").trim();
  const message = String(params.message || "").trim();
  const groupIds = (params.groupIds || []).map(normalizeGroupId).filter(Boolean);

  if (!clientId || !campaignId) throw new Error("clientId/campaignId são obrigatórios.");
  if (!message) throw new Error("message é obrigatório.");
  if (!groupIds.length) throw new Error("Sem grupos para envio.");

  const schedule = buildNotBeforeSchedule(groupIds.length, params.paceProfile);
  const now = nowIso();

  // trilha de envios (enfileirado com notBefore)
  const sends = await readAllSends();

  for (let i = 0; i < groupIds.length; i++) {
    const gid = groupIds[i];
    const notBefore = schedule[i];

    if (params.runId) {
      await upsertGroupRunItemQueued({ clientId, runId: String(params.runId), groupCampaignId: campaignId, groupId: gid });
    }

    await enqueueWhatsappText({
      clientId,
      to: gid,
      message,
      contactId: null,
      orderId: null,
      messageType: "assistant",
      context: {
        kind: "group_campaign",
        runId: params.runId ?? null,
        groupCampaignId: campaignId,
        campaignId,
        groupId: gid,
      },
      notBefore,
    });

    sends.push({
      id: createId("gsend"),
      groupCampaignId: campaignId,
      clientId,
      groupId: gid,
      status: "agendado",
      notBefore,
      createdAt: now,
    });
  }

  await writeAllSends(sends);
  return { enqueued: groupIds.length };
}

export async function markGroupCampaignSent(clientId: string, campaignId: string): Promise<GroupCampaign | null> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) return null;

  const now = nowIso();
  const updated: GroupCampaign = {
    ...all[idx],
    status: "disparada",
    lastSentAt: now,
    updatedAt: now,
  };
  all[idx] = updated;
  await writeAllCampaigns(all);
  return updated;
}


export async function pauseGroupCampaign(clientId: string, campaignId: string): Promise<GroupCampaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) {
    throw new Error("Campanha de grupos não encontrada.");
  }
  const now = nowIso();
  const next: GroupCampaign = { ...all[idx], status: "pausada", updatedAt: now };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}

export async function resumeGroupCampaign(clientId: string, campaignId: string): Promise<GroupCampaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) {
    throw new Error("Campanha de grupos não encontrada.");
  }
  const curr = all[idx];
  const now = nowIso();
  const nextStatus: GroupCampaignStatus = curr.status === "pausada" ? "rascunho" : curr.status;
  const next: GroupCampaign = { ...curr, status: nextStatus, updatedAt: now };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}

export async function cancelGroupCampaign(clientId: string, campaignId: string): Promise<GroupCampaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) {
    throw new Error("Campanha de grupos não encontrada.");
  }
  const now = nowIso();
  const next: GroupCampaign = { ...all[idx], status: "cancelada", updatedAt: now };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}

export async function recordGroupCampaignSendStatus(params: {
  groupCampaignId: string;
  clientId: string;
  groupId: string;
  status: GroupCampaignSendStatus;
  participantJid?: string | null;
}): Promise<GroupCampaignSend> {
  const all = await readAllSends();
  const now = nowIso();

  const idx = all.findIndex(
    (s) =>
      s.groupCampaignId === params.groupCampaignId &&
      s.clientId === params.clientId &&
      s.groupId === params.groupId
  );

  const base = idx >= 0 ? all[idx] : null;

  const next: GroupCampaignSend = {
    id: base?.id ?? createId("gsend"),
    groupCampaignId: params.groupCampaignId,
    clientId: params.clientId,
    groupId: params.groupId,
    participantJid: params.participantJid ?? (base as any)?.participantJid ?? null,
    status: params.status,
    notBefore: base?.notBefore ?? null,
    createdAt: base?.createdAt ?? now,
  };

  if (idx >= 0) {
    all[idx] = next;
  } else {
    all.push(next);
  }

  await writeAllSends(all);
  return next;
}