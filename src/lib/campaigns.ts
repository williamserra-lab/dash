// src/lib/campaigns.ts
// Camada de campanhas usando jsonStore para leitura/escrita robusta.

import { getContactsByClient } from "@/lib/contacts";
import { getListsByClient } from "@/lib/contactLists";
import { getListById } from "@/lib/contactLists";
import {
  getDataPath,
  readJsonArray,
  writeJsonArray,
} from "./jsonStore";

export type CampaignChannel = "whatsapp";

export type CampaignStatus =
  | "rascunho"
  | "simulada"
  | "disparada"
  | "pausada"
  | "cancelada";

export type CampaignMediaType = "image" | "video" | "audio" | "document";

export type CampaignMedia = {
  type: CampaignMediaType;
  fileId: string; // referência futura ao módulo Arquivos
  fileName?: string;
};

export type CampaignTargetConfig = {
  // When provided and non-empty, campaign targets ONLY these contacts.
  // When omitted or empty, campaign targets all eligible contacts.
  contactIds?: string[];
  // Tags (qualquer tag na lista) para segmentação.
  tagsAny?: string[];
  // Listas nomeadas (contact_lists.json).
  listIds?: string[];
  vipOnly: boolean;
  excludeOptOut: boolean;
  excludeBlocked: boolean;
};

export type CampaignSimulation = {
  totalContacts: number;
  eligibleContacts: number;
  vipContacts: number;
  lastSimulatedAt: string;
};

export type Campaign = {
  id: string;
  clientId: string;
  name: string;
  message: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  target: CampaignTargetConfig;
  simulation?: CampaignSimulation;
  media?: CampaignMedia[];
  createdAt: string;
  updatedAt: string;
};

export type CampaignSendStatus =
  | "simulado"
  | "agendado"
  | "enviado"
  | "erro";

export type CampaignSend = {
  id: string;
  campaignId: string;
  clientId: string;
  contactId: string;
  identifier: string; // ex: número de telefone
  status: CampaignSendStatus;
  createdAt: string;
};

const campaignsFile = getDataPath("campaigns.json");
const sendsFile = getDataPath("campaign_sends.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}


async function resolveTargetContactIds(
  clientId: string,
  target: CampaignTargetConfig
): Promise<Set<string> | null> {
  // null => significa "todos elegíveis"
  const ids = new Set<string>();

  const directIds = Array.isArray(target.contactIds)
    ? target.contactIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  for (const id of directIds) ids.add(id);

  const listIds = Array.isArray(target.listIds)
    ? target.listIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  for (const listId of listIds) {
    const list = await getListById(clientId, listId);
    if (!list) continue;
    for (const cid of list.contactIds) ids.add(cid);
  }

  return ids.size > 0 ? ids : null;
}

function normalizeTagsAny(target: CampaignTargetConfig): string[] {
  const raw = Array.isArray(target.tagsAny) ? target.tagsAny : [];
  return Array.from(new Set(raw.map((t) => String(t || "").trim()).filter(Boolean))).slice(0, 30);
}

async function readAllCampaigns(): Promise<Campaign[]> {
  const raw = await readJsonArray<Campaign>(campaignsFile);

  // Normaliza o alvo para lidar com registros antigos/incompletos
  return raw.map((c) => ({
    ...c,
    target: {
      vipOnly: Boolean(c.target?.vipOnly),
      excludeOptOut:
        c.target?.excludeOptOut === false ? false : true,
      excludeBlocked:
        c.target?.excludeBlocked === false ? false : true,
    },
  }));
}

async function writeAllCampaigns(list: Campaign[]): Promise<void> {
  await writeJsonArray<Campaign>(campaignsFile, list);
}

async function readAllSends(): Promise<CampaignSend[]> {
  const raw = await readJsonArray<unknown>(sendsFile);

  // Migração/normalização: versões antigas gravavam campaign_sends.json com outro schema (sem status).
  // Aqui preservamos o máximo possível e evitamos quebrar o dashboard.
  const now = new Date().toISOString();

  const normalized: CampaignSend[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!entry) continue;
    const campaignId = String((e as any).campaignId || "").trim();
    const clientId = String((e as any).clientId || "").trim();
    const contactId = String((e as any).contactId || "").trim();
    const identifier = String((e as any).identifier || "").trim();
    if (!campaignId || !clientId || !contactId || !identifier) continue;

    const statusRaw = (e as any).status;
    const status: CampaignSendStatus =
      statusRaw === "simulado" || statusRaw === "agendado" || statusRaw === "enviado" || statusRaw === "erro"
        ? statusRaw
        : "enviado";

    normalized.push({
      id: String((e as any).id || createId("send")),
      campaignId,
      clientId,
      contactId,
      identifier,
      status,
      createdAt: String((e as any).createdAt || now),
    });
  }

  return normalized;
}

async function writeAllSends(list: CampaignSend[]): Promise<void> {
  await writeJsonArray<CampaignSend>(sendsFile, list);
}

export async function getCampaignsByClient(
  clientId: string
): Promise<Campaign[]> {
  const all = await readAllCampaigns();
  return all
    .filter((c) => c.clientId === clientId)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}

export async function getCampaignById(
  clientId: string,
  campaignId: string
): Promise<Campaign | null> {
  const all = await readAllCampaigns();
  const found = all.find(
    (c) => c.clientId === clientId && c.id === campaignId
  );
  return found ?? null;
}

export async function createCampaign(params: {
  clientId: string;
  name: string;
  message: string;
  channel?: CampaignChannel;
  target?: Partial<CampaignTargetConfig>;
  media?: CampaignMedia[];
}): Promise<Campaign> {
  const all = await readAllCampaigns();
  const now = new Date().toISOString();

  const campaign: Campaign = {
    id: createId("cmp"),
    clientId: params.clientId,
    name: params.name.trim(),
    message: params.message.trim(),
    channel: params.channel ?? "whatsapp",
    status: "rascunho",
    target: {
      vipOnly: Boolean(params.target?.vipOnly),
      excludeOptOut:
        params.target?.excludeOptOut === false ? false : true,
      excludeBlocked:
        params.target?.excludeBlocked === false ? false : true,
    },
    media: params.media ?? [],
    createdAt: now,
    updatedAt: now,
  };

  all.push(campaign);
  await writeAllCampaigns(all);
  return campaign;
}

export async function simulateCampaign(
  campaignId: string
): Promise<Campaign | null> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaignId);
  if (idx < 0) return null;

  const campaign = all[idx];

  // Blindagem: se contatos derem erro, não derrubar a aplicação.
  let contacts: Awaited<ReturnType<typeof getContactsByClient>> = [];
  try {
    contacts = await getContactsByClient(campaign.clientId);
  } catch (err) {
    console.error(
      "Erro ao buscar contatos para simulação de campanha:",
      err
    );
    contacts = [];
  }

  const totalContacts = contacts.length;

  const contactIds = Array.isArray(campaign.target?.contactIds)
    ? campaign.target!.contactIds.map((x) => String(x)).filter(Boolean)
    : [];
  const allowedIds = contactIds.length > 0 ? new Set(contactIds) : null;

  const tagsAnyArr = Array.isArray(campaign.target?.tagsAny)
    ? campaign.target!.tagsAny.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  const tagsAny = tagsAnyArr.length > 0 ? new Set(tagsAnyArr) : null;

  const listIdsArr = Array.isArray(campaign.target?.listIds)
    ? campaign.target!.listIds.map((x) => String(x)).filter(Boolean)
    : [];
  const hasListIds = listIdsArr.length > 0;
  let listContactIds: Set<string> | null = null;
  if (hasListIds) {
    const lists = await getListsByClient(campaign.clientId);
        const wanted = new Set(listIdsArr);
    listContactIds = new Set<string>();
    for (const l of lists) {
      if (!wanted.has(String(l.id))) continue;
      for (const cid of Array.isArray(l.contactIds) ? l.contactIds : []) {
        const s = String(cid);
        if (s) listContactIds.add(s);
      }
    }
  }

  const eligible = contacts.filter((c) => {
    if (c.channel !== "whatsapp") return false;

    if (allowedIds && !allowedIds.has(String(c.id))) return false;

    if (tagsAny) {
      const ct = Array.isArray((c as any).tags) ? (c as any).tags : [];
      const ok = ct.some(
        (t: any) => tagsAny.has(String(t).trim().toLowerCase())
      );
      if (!ok) return false;
    }

    if (listContactIds && !listContactIds.has(String(c.id))) return false;

    if (campaign.target.excludeOptOut && c.optOutMarketing) return false;
    if (campaign.target.excludeBlocked && c.blockedGlobal) return false;
    if (campaign.target.vipOnly && !c.vip) return false;
    return true;
  });

  const vipContacts = eligible.filter((c) => c.vip).length;

  const now = new Date().toISOString();

  const simulation: CampaignSimulation = {
    totalContacts,
    eligibleContacts: eligible.length,
    vipContacts,
    lastSimulatedAt: now,
  };

  const updated: Campaign = {
    ...campaign,
    status: "simulada",
    simulation,
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllCampaigns(all);

  // registra envios simulados (um por contato elegível)
  const allSends = await readAllSends();
  for (const c of eligible) {
    const send: CampaignSend = {
      id: createId("send"),
      campaignId: updated.id,
      clientId: updated.clientId,
      contactId: c.id,
      identifier: c.identifier,
      status: "simulado",
      createdAt: now,
    };
    allSends.push(send);
  }
  await writeAllSends(allSends);

  return updated;
}

export async function markCampaignSent(
  campaign: Campaign
): Promise<Campaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaign.id);

  const now = new Date().toISOString();
  const updated: Campaign = {
    ...campaign,
    status: "disparada",
    updatedAt: now,
  };

  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.push(updated);
  }
  await writeAllCampaigns(all);

  return updated;
}


export async function recordCampaignSendStatus(params: {
  campaignId: string;
  clientId: string;
  contactId: string;
  identifier: string;
  status: CampaignSendStatus;
}): Promise<CampaignSend> {
  const all = await readAllSends();
  const now = new Date().toISOString();

  const idx = all.findIndex(
    (s) =>
      s.campaignId === params.campaignId &&
      s.clientId === params.clientId &&
      s.contactId === params.contactId
  );

  const next: CampaignSend = {
    id: idx >= 0 ? all[idx].id : createId("send"),
    campaignId: params.campaignId,
    clientId: params.clientId,
    contactId: params.contactId,
    identifier: params.identifier,
    status: params.status,
    createdAt: now,
  };

  if (idx >= 0) {
    all[idx] = next;
  } else {
    all.push(next);
  }

  await writeAllSends(all);
  return next;
}


export type CampaignSendSummary = {
  total: number;
  simulado: number;
  agendado: number;
  enviado: number;
  erro: number;
  lastAt?: string;
};

export type CampaignDashboardItem = Campaign & {
  sendSummary: CampaignSendSummary;
};

function summarizeSends(sends: CampaignSend[]): CampaignSendSummary {
  const out: CampaignSendSummary = {
    total: 0,
    simulado: 0,
    agendado: 0,
    enviado: 0,
    erro: 0,
    lastAt: undefined,
  };

  for (const s of sends) {
    out.total += 1;
    if (s.status === "simulado") out.simulado += 1;
    else if (s.status === "agendado") out.agendado += 1;
    else if (s.status === "enviado") out.enviado += 1;
    else if (s.status === "erro") out.erro += 1;

    const at = String(s.createdAt || "").trim();
    if (at) {
      if (!out.lastAt) out.lastAt = at;
      else {
        const a = Date.parse(out.lastAt);
        const b = Date.parse(at);
        if (Number.isFinite(b) && (!Number.isFinite(a) || b > a)) out.lastAt = at;
      }
    }
  }

  return out;
}

/**
 * Dashboard de status de campanhas (por cliente).
 * Retorna as campanhas com agregação de envios (campaign_sends.json).
 * Não altera schema existente; apenas agrega para uso do UI.
 */
export async function getCampaignDashboardByClient(
  clientId: string
): Promise<CampaignDashboardItem[]> {
  const campaigns = await getCampaignsByClient(clientId);
  const allSends = await readAllSends();

  const sendsByCampaign = new Map<string, CampaignSend[]>();
  for (const s of allSends) {
    if (s.clientId !== clientId) continue;
    const list = sendsByCampaign.get(s.campaignId) || [];
    list.push(s);
    sendsByCampaign.set(s.campaignId, list);
  }

  return campaigns.map((c) => {
    const sends = sendsByCampaign.get(c.id) || [];
    return { ...c, sendSummary: summarizeSends(sends) };
  });
}

export async function getSendsByCampaign(
  campaignId: string
): Promise<CampaignSend[]> {
  const all = await readAllSends();
  return all.filter((s) => s.campaignId === campaignId);
}

export async function pauseCampaign(clientId: string, campaignId: string): Promise<Campaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) throw new Error("Campanha não encontrada.");
  const next: Campaign = { ...all[idx], status: "pausada" };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}

export async function resumeCampaign(clientId: string, campaignId: string): Promise<Campaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) throw new Error("Campanha não encontrada.");
  const curr = all[idx];
  // Resume volta para rascunho (seguro) para permitir re-disparo depois.
  const next: Campaign = { ...curr, status: curr.status === "pausada" ? "rascunho" : curr.status };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}

export async function cancelCampaign(clientId: string, campaignId: string): Promise<Campaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.clientId === clientId && c.id === campaignId);
  if (idx < 0) throw new Error("Campanha não encontrada.");
  const next: Campaign = { ...all[idx], status: "cancelada" };
  all[idx] = next;
  await writeAllCampaigns(all);
  return next;
}