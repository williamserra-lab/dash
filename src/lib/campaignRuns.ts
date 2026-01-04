// src/lib/campaignRuns.ts
// Persistência de execuções (runs) de campanhas (1:1 e grupos).
// Step 24.1: modelo + store; sem testes de comportamento.

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type CampaignRunKind = "direct" | "group";

export type CampaignRunStatus = "queued" | "sending" | "paused" | "done" | "failed";

export type CampaignRun = {
  id: string;
  clientId: string;
  kind: CampaignRunKind;
  campaignId: string;

  status: CampaignRunStatus;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;

  // Métricas básicas (best-effort)
  totalTargets: number;
  enqueued: number;
  skipped: number;
  failed: number;

  // Auditoria mínima (sem payload sensível)
  lastError?: string | null;
};

const runsFile = getDataPath("campaign_runs.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${r1}${r2}`;
}

async function readAllRuns(): Promise<CampaignRun[]> {
  const raw = await readJsonArray<CampaignRun>(runsFile);
  const out: CampaignRun[] = [];
  const now = new Date().toISOString();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof (r as any).id !== "string") continue;
    out.push({
      id: String((r as any).id),
      clientId: String((r as any).clientId ?? ""),
      kind: ((r as any).kind === "group" ? "group" : "direct"),
      campaignId: String((r as any).campaignId ?? ""),
      status: normalizeStatus((r as any).status),
      createdAt: String((r as any).createdAt ?? now),
      startedAt: ((r as any).startedAt ?? null),
      finishedAt: ((r as any).finishedAt ?? null),
      totalTargets: Math.max(0, Number((r as any).totalTargets ?? 0) || 0),
      enqueued: Math.max(0, Number((r as any).enqueued ?? 0) || 0),
      skipped: Math.max(0, Number((r as any).skipped ?? 0) || 0),
      failed: Math.max(0, Number((r as any).failed ?? 0) || 0),
      lastError: ((r as any).lastError ?? null),
    });
  }
  return out;
}

function normalizeStatus(s: any): CampaignRunStatus {
  const v = String(s || "").toLowerCase();
  if (v === "queued" || v === "sending" || v === "paused" || v === "done" || v === "failed") return v;
  return "queued";
}

async function writeAllRuns(runs: CampaignRun[]): Promise<void> {
  await writeJsonArray(runsFile, runs);
}

export async function listRunsByCampaign(args: {
  clientId: string;
  campaignId: string;
  kind: CampaignRunKind;
  limit?: number;
}): Promise<CampaignRun[]> {
  const { clientId, campaignId, kind } = args;
  const limit = Math.max(1, Math.min(200, Number(args.limit ?? 50)));
  const all = await readAllRuns();
  return all
    .filter((r) => r.clientId === clientId && r.campaignId === campaignId && r.kind === kind)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export async function getRunById(clientId: string, runId: string): Promise<CampaignRun | null> {
  const all = await readAllRuns();
  return all.find((r) => r.clientId === clientId && r.id === runId) ?? null;
}

export async function createRun(args: {
  clientId: string;
  campaignId: string;
  kind: CampaignRunKind;
  totalTargets: number;
}): Promise<CampaignRun> {
  const now = new Date().toISOString();
  const run: CampaignRun = {
    id: createId("run"),
    clientId: args.clientId,
    kind: args.kind,
    campaignId: args.campaignId,
    status: "queued",
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    totalTargets: Math.max(0, Math.floor(Number(args.totalTargets || 0))),
    enqueued: 0,
    skipped: 0,
    failed: 0,
    lastError: null,
  };

  const all = await readAllRuns();
  all.push(run);
  await writeAllRuns(all);
  return run;
}

export async function updateRun(run: CampaignRun): Promise<CampaignRun> {
  const all = await readAllRuns();
  const idx = all.findIndex((r) => r.clientId === run.clientId && r.id === run.id);
  if (idx >= 0) {
    all[idx] = run;
  } else {
    all.push(run);
  }
  await writeAllRuns(all);
  return run;
}

export async function setRunStatus(args: {
  clientId: string;
  runId: string;
  status: CampaignRunStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
  enqueued?: number;
  skipped?: number;
  failed?: number;
  totalTargets?: number;
}): Promise<CampaignRun | null> {
  const all = await readAllRuns();
  const idx = all.findIndex((r) => r.clientId === args.clientId && r.id === args.runId);
  if (idx < 0) return null;
  const prev = all[idx];
  const next: CampaignRun = {
    ...prev,
    status: args.status,
    startedAt: args.startedAt !== undefined ? args.startedAt : prev.startedAt ?? null,
    finishedAt: args.finishedAt !== undefined ? args.finishedAt : prev.finishedAt ?? null,
    lastError: args.lastError !== undefined ? args.lastError : prev.lastError ?? null,
    totalTargets: args.totalTargets !== undefined ? Math.max(0, Math.floor(Number(args.totalTargets))) : prev.totalTargets,
    enqueued: args.enqueued !== undefined ? Math.max(0, Math.floor(Number(args.enqueued))) : prev.enqueued,
    skipped: args.skipped !== undefined ? Math.max(0, Math.floor(Number(args.skipped))) : prev.skipped,
    failed: args.failed !== undefined ? Math.max(0, Math.floor(Number(args.failed))) : prev.failed,
  };
  all[idx] = next;
  await writeAllRuns(all);
  return next;
}
