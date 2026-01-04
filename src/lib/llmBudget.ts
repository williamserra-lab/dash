// src/lib/llmBudget.ts
// Governança de consumo de LLM (tokens) por clientId.
//
// Storage strategy:
// - When NEXTIA_DB_URL is set, usage is persisted in Postgres (atomic UPSERT per month).
// - Otherwise, falls back to JSON store in /data.

import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";
import { dbQuery, isDbEnabled } from "@/lib/db";

export type LlmOverLimitMode = "degrade" | "block";

export type LlmBudgetPolicy = {
  // limite mensal em tokens (prompt+completion)
  monthlyTokenLimit: number;
  // comportamento quando ultrapassa
  overLimitMode: LlmOverLimitMode;
};

export class LlmBudgetExceededError extends Error {
  code = "llm_budget_exceeded" as const;
  clientId: string;
  monthKey: string;
  usedTokens: number;
  limitTokens: number;

  constructor(args: {
    clientId: string;
    monthKey: string;
    usedTokens: number;
    limitTokens: number;
  }) {
    super(
      `LLM budget exceeded for clientId=${args.clientId}: ${args.usedTokens}/${args.limitTokens} tokens in ${args.monthKey}`
    );
    this.clientId = args.clientId;
    this.monthKey = args.monthKey;
    this.usedTokens = args.usedTokens;
    this.limitTokens = args.limitTokens;
  }
}

export type LlmUsageMonth = {
  monthKey: string; // YYYY-MM
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  lastUpdatedAt: string;
  // melhor esforço (podem faltar em alguns providers)
  provider?: string | null;
  model?: string | null;
};

export type LlmUsageStore = Record<string, Record<string, LlmUsageMonth>>; // clientId -> monthKey -> usage

export type LlmBudgetStore = Record<string, Partial<LlmBudgetPolicy>>; // overrides por clientId

const USAGE_FILE = getDataPath("llm_usage.json");
const BUDGET_FILE = getDataPath("llm_budgets.json");

function nowIso(): string {
  return new Date().toISOString();
}

export function getMonthKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function envInt(name: string): number | null {
  const raw = (process.env[name] || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function getDefaultPolicy(): LlmBudgetPolicy {
  const monthlyTokenLimit =
    envInt("NEXTIA_LLM_MONTHLY_TOKEN_LIMIT") ??
    envInt("NEXTIA_BUDGET_MONTHLY_TOKENS_DEFAULT") ??
    250_000; // default conservador

  const modeRaw = (
    process.env.NEXTIA_LLM_OVER_LIMIT_MODE ||
    process.env.NEXTIA_BUDGET_LLM_MODE ||
    "degrade"
  )
    .trim()
    .toLowerCase();
  const overLimitMode: LlmOverLimitMode = modeRaw === "block" ? "block" : "degrade";

  return { monthlyTokenLimit, overLimitMode };
}

export async function getPolicyForClient(clientId: string): Promise<LlmBudgetPolicy> {
  const base = getDefaultPolicy();
  const budgets = await readJsonValue<LlmBudgetStore>(BUDGET_FILE, {});
  const override = budgets[clientId] || {};
  return {
    monthlyTokenLimit:
      typeof override.monthlyTokenLimit === "number" && override.monthlyTokenLimit > 0
        ? Math.floor(override.monthlyTokenLimit)
        : base.monthlyTokenLimit,
    overLimitMode:
      override.overLimitMode === "block" || override.overLimitMode === "degrade"
        ? override.overLimitMode
        : base.overLimitMode,
  };
}

export async function setPolicyForClient(
  clientId: string,
  patch: Partial<LlmBudgetPolicy>
): Promise<LlmBudgetPolicy> {
  const budgets = await readJsonValue<LlmBudgetStore>(BUDGET_FILE, {});
  const current = budgets[clientId] || {};
  const next: Partial<LlmBudgetPolicy> = { ...current };
  if (typeof patch.monthlyTokenLimit === "number" && patch.monthlyTokenLimit > 0) {
    next.monthlyTokenLimit = Math.floor(patch.monthlyTokenLimit);
  }
  if (patch.overLimitMode === "block" || patch.overLimitMode === "degrade") {
    next.overLimitMode = patch.overLimitMode;
  }
  budgets[clientId] = next;
  await writeJsonValue(BUDGET_FILE, budgets);
  return await getPolicyForClient(clientId);
}

async function getUsageMonthDb(clientId: string, monthKey: string): Promise<LlmUsageMonth> {
  const res = await dbQuery<{
    month_key: string;
    total_tokens: string | number;
    prompt_tokens: string | number;
    completion_tokens: string | number;
    last_updated_at: string;
    provider: string | null;
    model: string | null;
  }>(
    `SELECT month_key, total_tokens, prompt_tokens, completion_tokens, last_updated_at, provider, model
     FROM nextia_llm_usage_monthly
     WHERE client_id = $1 AND month_key = $2
     LIMIT 1;`,
    [clientId, monthKey]
  );

  const row = res.rows?.[0];
  if (!row) {
    return {
      monthKey,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      lastUpdatedAt: nowIso(),
      provider: null,
      model: null,
    };
  }

  const toNum = (v: string | number) => Math.max(0, Number(v || 0));

  return {
    monthKey: String(row.month_key),
    totalTokens: toNum(row.total_tokens),
    promptTokens: toNum(row.prompt_tokens),
    completionTokens: toNum(row.completion_tokens),
    lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : nowIso(),
    provider: row.provider ?? null,
    model: row.model ?? null,
  };
}

async function addUsageDb(
  clientId: string,
  args: {
    monthKey: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    provider?: string | null;
    model?: string | null;
  }
): Promise<LlmUsageMonth> {
  const res = await dbQuery<{
    month_key: string;
    total_tokens: string | number;
    prompt_tokens: string | number;
    completion_tokens: string | number;
    last_updated_at: string;
    provider: string | null;
    model: string | null;
  }>(
    `INSERT INTO nextia_llm_usage_monthly
      (client_id, month_key, total_tokens, prompt_tokens, completion_tokens, provider, model, last_updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (client_id, month_key) DO UPDATE SET
      total_tokens = nextia_llm_usage_monthly.total_tokens + EXCLUDED.total_tokens,
      prompt_tokens = nextia_llm_usage_monthly.prompt_tokens + EXCLUDED.prompt_tokens,
      completion_tokens = nextia_llm_usage_monthly.completion_tokens + EXCLUDED.completion_tokens,
      provider = COALESCE(EXCLUDED.provider, nextia_llm_usage_monthly.provider),
      model = COALESCE(EXCLUDED.model, nextia_llm_usage_monthly.model),
      last_updated_at = NOW()
     RETURNING month_key, total_tokens, prompt_tokens, completion_tokens, last_updated_at, provider, model;`,
    [
      clientId,
      args.monthKey,
      args.totalTokens,
      args.promptTokens,
      args.completionTokens,
      args.provider ?? null,
      args.model ?? null,
    ]
  );

  const row = res.rows?.[0];
  if (!row) {
    // Defensive fallback (should not happen)
    return await getUsageMonthDb(clientId, args.monthKey);
  }

  const toNum = (v: string | number) => Math.max(0, Number(v || 0));

  return {
    monthKey: String(row.month_key),
    totalTokens: toNum(row.total_tokens),
    promptTokens: toNum(row.prompt_tokens),
    completionTokens: toNum(row.completion_tokens),
    lastUpdatedAt: row.last_updated_at ? new Date(row.last_updated_at).toISOString() : nowIso(),
    provider: row.provider ?? null,
    model: row.model ?? null,
  };
}

export async function getUsageMonth(
  clientId: string,
  monthKey: string = getMonthKey()
): Promise<LlmUsageMonth> {
  if (isDbEnabled()) {
    return await getUsageMonthDb(clientId, monthKey);
  }

  const store = await readJsonValue<LlmUsageStore>(USAGE_FILE, {});
  const byClient = store[clientId] || {};
  const existing = byClient[monthKey];
  if (existing) return existing;

  return {
    monthKey,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUpdatedAt: nowIso(),
    provider: null,
    model: null,
  };
}

export async function addUsage(
  clientId: string,
  delta: {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    provider?: string | null;
    model?: string | null;
    monthKey?: string;
  }
): Promise<LlmUsageMonth> {
  const monthKey = delta.monthKey || getMonthKey();

  const p = Math.max(0, Math.floor(Number(delta.promptTokens || 0)));
  const c = Math.max(0, Math.floor(Number(delta.completionTokens || 0)));
  const tRaw = delta.totalTokens != null ? Math.floor(Number(delta.totalTokens)) : p + c;
  const t = Math.max(0, tRaw);

  if (isDbEnabled()) {
    return await addUsageDb(clientId, {
      monthKey,
      promptTokens: p,
      completionTokens: c,
      totalTokens: t,
      provider: delta.provider ?? null,
      model: delta.model ?? null,
    });
  }

  const store = await readJsonValue<LlmUsageStore>(USAGE_FILE, {});
  const byClient = store[clientId] || {};
  const existing = byClient[monthKey] || {
    monthKey,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUpdatedAt: nowIso(),
    provider: null,
    model: null,
  };

  const updated: LlmUsageMonth = {
    ...existing,
    promptTokens: existing.promptTokens + p,
    completionTokens: existing.completionTokens + c,
    totalTokens: existing.totalTokens + t,
    lastUpdatedAt: nowIso(),
    provider: delta.provider ?? existing.provider ?? null,
    model: delta.model ?? existing.model ?? null,
  };

  byClient[monthKey] = updated;
  store[clientId] = byClient;
  await writeJsonValue(USAGE_FILE, store);
  return updated;
}

export async function getBudgetSnapshot(clientId: string): Promise<{
  monthKey: string;
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  percentUsed: number;
  overLimitMode: LlmOverLimitMode;
}> {
  const monthKey = getMonthKey();
  const usage = await getUsageMonth(clientId, monthKey);
  const policy = await getPolicyForClient(clientId);

  const used = Math.max(0, usage.totalTokens || 0);
  const limit = Math.max(1, policy.monthlyTokenLimit);
  const remaining = Math.max(0, limit - used);
  const percent = Math.min(100, Math.round((used / limit) * 100));

  return {
    monthKey,
    usedTokens: used,
    limitTokens: limit,
    remainingTokens: remaining,
    percentUsed: percent,
    overLimitMode: policy.overLimitMode,
  };
}

export async function isOverBudget(clientId: string): Promise<boolean> {
  const snap = await getBudgetSnapshot(clientId);
  return snap.usedTokens >= snap.limitTokens;
}

/**
 * Regra central: se ultrapassou o limite, você decide no chamador como agir (degrade/block)
 * olhando overLimitMode.
 */
export async function checkBudgetOrThrow(args: {
  clientId: string;
}): Promise<{ monthKey: string; usedTokens: number; limitTokens: number; overLimitMode: LlmOverLimitMode }> {
  const snap = await getBudgetSnapshot(args.clientId);
  if (snap.usedTokens >= snap.limitTokens) {
    // O chamador pode tratar e degradar, ou bloquear.
    throw new LlmBudgetExceededError({
      clientId: args.clientId,
      monthKey: snap.monthKey,
      usedTokens: snap.usedTokens,
      limitTokens: snap.limitTokens,
    });
  }
  return {
    monthKey: snap.monthKey,
    usedTokens: snap.usedTokens,
    limitTokens: snap.limitTokens,
    overLimitMode: snap.overLimitMode,
  };
}
