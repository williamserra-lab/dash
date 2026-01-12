// src/lib/llmBudgetReset.ts
// Reset helpers for admin/test UI. DB mode is intentionally unsupported.

import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";
import { isDbEnabled } from "@/lib/db";
import type { LlmUsageMonth, LlmUsageStore, LlmUsageContextMonth } from "@/lib/llmBudget";

const USAGE_FILE = getDataPath("llm_usage.json");
const CONTEXT_USAGE_FILE = getDataPath("llm_usage_context.json");

function nowIso(): string {
  return new Date().toISOString();
}

export async function resetUsageMonthForClient(args: { clientId: string; monthKey: string }) {
  const { clientId, monthKey } = args;

  if (isDbEnabled()) {
    // We fail closed: reset in DB requires explicit SQL or a dedicated migration/tooling.
    throw new Error("Reset de uso (tokens) não suportado em modo DB.");
  }

  const store = await readJsonValue<LlmUsageStore>(USAGE_FILE, {});
  const byClient = store[clientId] || {};
  const empty: LlmUsageMonth = {
    monthKey,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    lastUpdatedAt: nowIso(),
    provider: null,
    model: null,
  };
  byClient[monthKey] = empty;
  store[clientId] = byClient;
  await writeJsonValue(USAGE_FILE, store);

  const ctxStore =
    (await readJsonValue<Record<string, LlmUsageContextMonth>>(CONTEXT_USAGE_FILE, {})) || {};
  const key = `${clientId}__${monthKey}`;
  ctxStore[key] = {
    clientId,
    monthKey,
    totals: { totalTokens: 0, promptTokens: 0, completionTokens: 0 },
    byContext: {},
    lastUpdatedAt: nowIso(),
  };
  await writeJsonValue(CONTEXT_USAGE_FILE, ctxStore);
}
