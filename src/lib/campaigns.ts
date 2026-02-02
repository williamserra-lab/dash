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
  | "em_andamento"
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

  // Timestamps (best-effort; campos podem estar ausentes em registros antigos)
  createdAt: string; // criação do registro de envio (primeira vez que apareceu)
  scheduledAt?: string | null; // quando entrou em "agendado"
  sentAt?: string | null; // quando foi efetivamente enviado (runner/outbox)
  statusUpdatedAt?: string | null; // última mudança de status (enviado/erro/agendado/etc.)

  // Retorno do destinatário após campanha (primeiro inbound do contato)
  firstReplyAt?: string | null;
  replied24h?: boolean;
  replied7d?: boolean;
};

const campaignsFile = getDataPath("campaigns.json");
const sendsFile = getDataPath("campaign_sends.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}


function normalizeStringArray(value: unknown, max: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const arr = (value as any[])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, max);
  return arr.length > 0 ? (arr as string[]) : undefined;
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
      // arrays/filters (preserva registros antigos sem quebrar)
      contactIds: normalizeStringArray((c as any).target?.contactIds, 20000),
      tagsAny: normalizeStringArray((c as any).target?.tagsAny, 30),
      listIds: normalizeStringArray((c as any).target?.listIds, 2000),

      // flags
      vipOnly: Boolean((c as any).target?.vipOnly),
      excludeOptOut: (c as any).target?.excludeOptOut === false ? false : true,
      excludeBlocked: (c as any).target?.excludeBlocked === false ? false : true,
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

      // timestamps (preserva se existirem)
      createdAt: String((e as any).createdAt || now),
      scheduledAt: (e as any).scheduledAt ?? null,
      sentAt: (e as any).sentAt ?? null,
      statusUpdatedAt: (e as any).statusUpdatedAt ?? null,

      // retorno do destinatário (preserva se existirem)
      firstReplyAt: (e as any).firstReplyAt ?? null,
      replied24h: Boolean((e as any).replied24h),
      replied7d: Boolean((e as any).replied7d),
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
      contactIds: Array.isArray(params.target?.contactIds)
        ? params.target!.contactIds
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(0, 20000)
        : undefined,
      tagsAny: normalizeTagsAny({
        ...((params.target || {}) as any),
        vipOnly: Boolean(params.target?.vipOnly),
        excludeOptOut: params.target?.excludeOptOut === false ? false : true,
        excludeBlocked: params.target?.excludeBlocked === false ? false : true,
      } as any),
      listIds: Array.isArray(params.target?.listIds)
        ? params.target!.listIds
            .map((x) => String(x || "").trim())
            .filter(Boolean)
            .slice(0, 2000)
        : undefined,

      vipOnly: Boolean(params.target?.vipOnly),
      excludeOptOut: params.target?.excludeOptOut === false ? false : true,
      excludeBlocked: params.target?.excludeBlocked === false ? false : true,
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


  const eligible = await getEligibleWhatsAppContactsForCampaign({
    clientId: campaign.clientId,
    target: campaign.target,
    contacts,
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

  // Registra envios simulados (um por contato elegível) SEM duplicar.
  // Importante: simulação não deve rebaixar status já existentes (agendado/enviado/erro).
  // Ela só cria o registro caso ainda não exista.
  const allSends = await readAllSends();
  const existingKey = new Set<string>();
  for (const s of allSends) {
    if (s.campaignId !== updated.id) continue;
    if (s.clientId !== updated.clientId) continue;
    existingKey.add(`${s.clientId}::${s.campaignId}::${s.contactId}`);
  }

  let created = 0;
  for (const c of eligible) {
    const key = `${updated.clientId}::${updated.id}::${c.id}`;
    if (existingKey.has(key)) continue;
    created += 1;
    allSends.push({
      id: createId("send"),
      campaignId: updated.id,
      clientId: updated.clientId,
      contactId: c.id,
      identifier: c.identifier,
      status: "simulado",
      createdAt: now,
      scheduledAt: null,
      sentAt: null,
      statusUpdatedAt: now,
      firstReplyAt: null,
      replied24h: false,
      replied7d: false,
    });
  }

  if (created > 0) {
    await writeAllSends(allSends);
  }

  return updated;
}

export async function markCampaignSent(
  campaign: Campaign,
  nextStatus: CampaignStatus = "disparada"
): Promise<Campaign> {
  const all = await readAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaign.id);

  const now = new Date().toISOString();
  const updated: Campaign = {
    ...campaign,
    status: nextStatus,
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

  const prev = idx >= 0 ? (all[idx] as CampaignSend) : null;

  const next: CampaignSend = {
    id: prev?.id || createId("send"),
    campaignId: params.campaignId,
    clientId: params.clientId,
    contactId: params.contactId,
    identifier: params.identifier,
    status: params.status,

    // preserva campos antigos quando existir
    createdAt: prev?.createdAt || now,
    scheduledAt: prev?.scheduledAt ?? null,
    sentAt: prev?.sentAt ?? null,
    statusUpdatedAt: now,

    firstReplyAt: prev?.firstReplyAt ?? null,
    replied24h: prev?.replied24h ?? false,
    replied7d: prev?.replied7d ?? false,
  };

  // timestamps por status
  if (params.status === "agendado" && !next.scheduledAt) {
    next.scheduledAt = now;
  }
  if (params.status === "enviado" && !next.sentAt) {
    next.sentAt = now;
  }

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

  // Retornos (primeiro inbound do destinatário após envio)
  replied24h: number;
  replied7d: number;

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
    replied24h: 0,
    replied7d: 0,
    lastAt: undefined,
  };

  for (const s of sends) {
    out.total += 1;
    if (s.status === "simulado") out.simulado += 1;
    else if (s.status === "agendado") out.agendado += 1;
    else if (s.status === "enviado") out.enviado += 1;
    else if (s.status === "erro") out.erro += 1;

    if ((s as any).replied24h) out.replied24h += 1;
    if ((s as any).replied7d) out.replied7d += 1;

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



/**
 * Resolve contatos elegíveis para uma campanha (WhatsApp), aplicando o mesmo alvo
 * usado na simulação e no disparo.
 *
 * Importante:
 * - respeita contactIds, tagsAny e listIds (quando fornecidos)
 * - respeita flags vipOnly / excludeOptOut / excludeBlocked
 * - filtra channel=whatsapp
 */
export async function getEligibleWhatsAppContactsForCampaign(params: {
  clientId: string;
  target: CampaignTargetConfig;
  contacts?: Awaited<ReturnType<typeof getContactsByClient>>;
}): Promise<Awaited<ReturnType<typeof getContactsByClient>>> {
  const clientId = String(params.clientId || "").trim();
  if (!clientId) return [];

  // Blindagem: se contatos/listas derem erro, não derruba o app.
  let contacts: Awaited<ReturnType<typeof getContactsByClient>> = Array.isArray(params.contacts) ? params.contacts : [];
  if (!contacts.length) {
    try {
      contacts = await getContactsByClient(clientId);
    } catch (err) {
      console.error("Erro ao buscar contatos (campanha):", err);
      return [];
    }
  }

  const target = params.target;

  // ContactIds diretos e/ou via listas.
  let allowedIds: Set<string> | null = null;
  try {
    const resolved = await resolveTargetContactIds(clientId, target);
    allowedIds = resolved ? new Set(Array.from(resolved).map(String)) : null;
  } catch (err) {
    console.error("Erro ao resolver alvo por listas (campanha):", err);
    allowedIds = null;
  }

  // TagsAny (qualquer tag na lista)
  const tagsAnyArr = normalizeTagsAny(target).map((t) => t.toLowerCase());
  const tagsAny = tagsAnyArr.length ? new Set(tagsAnyArr) : null;

  return contacts.filter((c) => {
    if (c.channel !== "whatsapp") return false;

    if (allowedIds && !allowedIds.has(String(c.id))) return false;

    if (tagsAny) {
      const ct = Array.isArray((c as any).tags) ? (c as any).tags : [];
      const ok = ct.some((t: any) =>
        tagsAny.has(String(t || "").trim().toLowerCase())
      );
      if (!ok) return false;
    }

    if (target.excludeOptOut && c.optOutMarketing) return false;
    if (target.excludeBlocked && c.blockedGlobal) return false;
    if (target.vipOnly && !c.vip) return false;

    return true;
  });
}

function normalizeIdentifierDigitsOnly(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

/**
 * Marca retorno do destinatário após envio de campanha (MVP).
 * Regra:
 * - procura o último envio "enviado" para o identifier dentro de até 7 dias
 * - marca apenas a primeira resposta (firstReplyAt) por destinatário/registro
 * - replied24h true se (replyAt - sentAt) <= 24h
 * - replied7d true se <= 7 dias
 */
export async function recordCampaignInboundReply(params: {
  clientId: string;
  identifier: string; // phone digits
  replyAt: string; // ISO
}): Promise<CampaignSend | null> {
  const clientId = String(params.clientId || "").trim();
  if (!clientId) return null;

  const identifier = normalizeIdentifierDigitsOnly(params.identifier);
  if (!identifier) return null;

  const replyAtMs = Date.parse(params.replyAt);
  if (!Number.isFinite(replyAtMs)) return null;

  const all = await readAllSends();

  // candidatos: enviado + sentAt dentro de 7 dias antes da resposta
  const maxWindowMs = 7 * 24 * 60 * 60 * 1000;
  let bestIdx = -1;
  let bestSentAtMs = -1;

  for (let i = 0; i < all.length; i++) {
    const s = all[i] as CampaignSend;
    if (s.clientId !== clientId) continue;
    if (normalizeIdentifierDigitsOnly(s.identifier) !== identifier) continue;
    if (s.status !== "enviado") continue;

    const sentAt = String((s as any).sentAt || "");
    const sentAtMs = Date.parse(sentAt);
    if (!Number.isFinite(sentAtMs)) continue;
    if (replyAtMs < sentAtMs) continue;

    const delta = replyAtMs - sentAtMs;
    if (delta > maxWindowMs) continue;

    if (sentAtMs > bestSentAtMs) {
      bestSentAtMs = sentAtMs;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return null;

  const prev = all[bestIdx] as CampaignSend;
  // só a primeira conversa
  if (prev.firstReplyAt) return prev;

  const delta = replyAtMs - bestSentAtMs;
  const replied24h = delta <= 24 * 60 * 60 * 1000;
  const replied7d = true;

  const next: CampaignSend = {
    ...prev,
    firstReplyAt: params.replyAt,
    replied24h,
    replied7d,
    statusUpdatedAt: new Date().toISOString(),
  };

  all[bestIdx] = next;
  await writeAllSends(all);
  return next;
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