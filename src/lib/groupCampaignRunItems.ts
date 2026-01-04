// src/lib/groupCampaignRunItems.ts
// Auditoria por destinatário para execuções (runs) de campanhas em grupos.

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type GroupCampaignRunItemStatus = "queued" | "sent" | "failed" | "simulated";

export type GroupCampaignRunItem = {
  id: string;
  clientId: string;
  runId: string;
  groupCampaignId: string;
  groupId: string;
  status: GroupCampaignRunItemStatus;
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
};

const itemsFile = getDataPath("group_campaign_run_items.json");

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

export async function upsertGroupRunItemQueued(params: {
  clientId: string;
  runId: string;
  groupCampaignId: string;
  groupId: string;
}): Promise<GroupCampaignRunItem> {
  const now = nowIso();
  const clientId = norm(params.clientId);
  const runId = norm(params.runId);
  const groupCampaignId = norm(params.groupCampaignId);
  const groupId = norm(params.groupId);

  const all = await readJsonArray<GroupCampaignRunItem>(itemsFile);
  const arr: GroupCampaignRunItem[] = Array.isArray(all) ? all : [];

  const idx = arr.findIndex(
    (x) => x.clientId === clientId && x.runId === runId && x.groupCampaignId === groupCampaignId && x.groupId === groupId
  );

  if (idx >= 0) {
    const prev = arr[idx];
    const updated: GroupCampaignRunItem = { ...prev, updatedAt: now };
    arr[idx] = updated;
    await writeJsonArray(itemsFile, arr);
    return updated;
  }

  const item: GroupCampaignRunItem = {
    id: createId("gri"),
    clientId,
    runId,
    groupCampaignId,
    groupId,
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

export async function markGroupRunItemResult(params: {
  clientId: string;
  runId: string;
  groupCampaignId: string;
  groupId: string;
  status: GroupCampaignRunItemStatus;
  error?: string | null;
  sentAt?: string | null;
}): Promise<GroupCampaignRunItem | null> {
  const now = nowIso();
  const clientId = norm(params.clientId);
  const runId = norm(params.runId);
  const groupCampaignId = norm(params.groupCampaignId);
  const groupId = norm(params.groupId);
  const status = params.status;
  const error = clampError(params.error);

  const all = await readJsonArray<GroupCampaignRunItem>(itemsFile);
  const arr: GroupCampaignRunItem[] = Array.isArray(all) ? all : [];

  const idx = arr.findIndex(
    (x) => x.clientId === clientId && x.runId === runId && x.groupCampaignId === groupCampaignId && x.groupId === groupId
  );

  if (idx < 0) {
    const created: GroupCampaignRunItem = {
      id: createId("gri"),
      clientId,
      runId,
      groupCampaignId,
      groupId,
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
  const updated: GroupCampaignRunItem = {
    ...prev,
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
