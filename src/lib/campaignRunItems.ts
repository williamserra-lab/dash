// src/lib/campaignRunItems.ts
// Auditoria por destinatário para execuções (runs) de campanhas 1:1 (direct).
//
// Persistência: JSON em data/campaign_run_items.json (mesmo padrão de outras stores).
// Nota: Em modo DB, a outbox já pode estar em DB, mas este ledger permanece em JSON por enquanto.

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type CampaignRunItemStatus = "queued" | "sent" | "failed" | "simulated";

export type CampaignRunItem = {
  id: string;
  clientId: string;
  runId: string;
  campaignId: string;
  contactId: string;
  identifier: string;
  status: CampaignRunItemStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
};

const itemsFile = getDataPath("campaign_run_items.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function norm(v: any): string {
  return String(v || "").trim();
}

function clampError(err: any): string | null {
  const s = norm(err);
  if (!s) return null;
  return s.length > 500 ? s.slice(0, 500) : s;
}

export async function listRunItems(params: {
  clientId: string;
  runId: string;
}): Promise<CampaignRunItem[]> {
  const clientId = norm(params.clientId);
  const runId = norm(params.runId);
  const all = await readJsonArray<CampaignRunItem>(itemsFile);
  return (Array.isArray(all) ? all : []).filter((x) => x.clientId === clientId && x.runId === runId);
}

export async function upsertRunItemQueued(params: {
  clientId: string;
  runId: string;
  campaignId: string;
  contactId: string;
  identifier: string;
}): Promise<CampaignRunItem> {
  const now = nowIso();
  const clientId = norm(params.clientId);
  const runId = norm(params.runId);
  const campaignId = norm(params.campaignId);
  const contactId = norm(params.contactId);
  const identifier = norm(params.identifier);

  const all = await readJsonArray<CampaignRunItem>(itemsFile);
  const arr: CampaignRunItem[] = Array.isArray(all) ? all : [];

  const idx = arr.findIndex(
    (x) => x.clientId === clientId && x.runId === runId && x.campaignId === campaignId && x.contactId === contactId
  );

  if (idx >= 0) {
    const existing = arr[idx];
    const updated: CampaignRunItem = {
      ...existing,
      identifier: identifier || existing.identifier,
      status: existing.status || "queued",
      updatedAt: now,
    };
    arr[idx] = updated;
    await writeJsonArray(itemsFile, arr);
    return updated;
  }

  const item: CampaignRunItem = {
    id: createId("cri"),
    clientId,
    runId,
    campaignId,
    contactId,
    identifier,
    status: "queued",
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
  };
  arr.push(item);
  await writeJsonArray(itemsFile, arr);
  return item;
}

export async function markRunItemResult(params: {
  clientId: string;
  runId: string;
  campaignId: string;
  contactId: string;
  identifier: string;
  status: CampaignRunItemStatus;
  error?: string | null;
  sentAt?: string | null;
}): Promise<CampaignRunItem | null> {
  const now = nowIso();
  const clientId = norm(params.clientId);
  const runId = norm(params.runId);
  const campaignId = norm(params.campaignId);
  const contactId = norm(params.contactId);
  const identifier = norm(params.identifier);
  const status = params.status;
  const error = clampError(params.error);

  const all = await readJsonArray<CampaignRunItem>(itemsFile);
  const arr: CampaignRunItem[] = Array.isArray(all) ? all : [];

  const idx = arr.findIndex(
    (x) => x.clientId === clientId && x.runId === runId && x.campaignId === campaignId && x.contactId === contactId
  );

  if (idx < 0) {
    // Se não existir, cria para não perder auditoria (best-effort).
    const created: CampaignRunItem = {
      id: createId("cri"),
      clientId,
      runId,
      campaignId,
      contactId,
      identifier,
      status,
      attempts: status === "queued" ? 0 : 1,
      lastError: status === "failed" ? error : null,
      createdAt: now,
      updatedAt: now,
      sentAt: params.sentAt ?? (status === "sent" ? now : null),
    };
    arr.push(created);
    await writeJsonArray(itemsFile, arr);
    return created;
  }

  const prev = arr[idx];
  const attempts = prev.attempts + (status === "queued" ? 0 : 1);

  const updated: CampaignRunItem = {
    ...prev,
    identifier: identifier || prev.identifier,
    status,
    attempts,
    lastError: status === "failed" ? error : null,
    updatedAt: now,
    sentAt: params.sentAt ?? (status === "sent" ? now : prev.sentAt ?? null),
  };
  arr[idx] = updated;
  await writeJsonArray(itemsFile, arr);
  return updated;
}
