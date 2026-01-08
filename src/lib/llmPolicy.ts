// src/lib/llmPolicy.ts
// Central policy engine for LLM governance decisions.
//
// Single source of truth to decide allow / degrade / block based on:
// - clientId monthly usage snapshot
// - stored policy (limits)
// - fixed warning/block thresholds (C model)

import { getBudgetSnapshot, getPolicyForClient, type LlmBudgetPolicy } from "@/lib/llmBudget";

export type LlmContext = "inbound" | "campaign";

export type LlmDecisionAction = "allow" | "degrade" | "block";

export type LlmDecisionSeverity = "none" | "warn" | "error";

export type LlmDecision = {
  action: LlmDecisionAction;
  overLimit: boolean;
  usagePct: number; // can exceed 100
  severity: LlmDecisionSeverity;
  message: string;
  thresholds: { warnPct: number; blockPct: number };
  snapshot: {
    usedTokens: number;
    limitTokens: number;
    remainingTokens: number; // can be negative
    monthKey: string;
  };
  policy: LlmBudgetPolicy;
};

function pct(used: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return (used / limit) * 100;
}

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat("pt-BR").format(Math.trunc(n));
  } catch {
    return String(Math.trunc(n));
  }
}

export async function resolveLlmDecision(args: { clientId: string; context: LlmContext }): Promise<LlmDecision> {
  const warnPct = 80;
  const blockPct = 100;

  const policy = await getPolicyForClient(args.clientId);
  const snap = await getBudgetSnapshot(args.clientId);

  const used = snap.usedTokens;
  const limit = snap.limitTokens;
  const usagePct = pct(used, limit);
  const remaining = limit - used;

  let action: LlmDecisionAction = "allow";
  let severity: LlmDecisionSeverity = "none";
  let overLimit = false;
  let message = "";

  if (limit > 0 && usagePct >= blockPct) {
    action = "block";
    severity = "error";
    overLimit = true;
    message =
      "Limite de IA atingido (100%). A funcionalidade de resposta automática foi suspensa até o próximo ciclo ou upgrade.";
  } else if (limit > 0 && usagePct >= warnPct) {
    action = "degrade";
    severity = "warn";
    overLimit = true;
    const remainingTxt = remaining > 0 ? `${formatInt(remaining)} tokens restantes` : "sem tokens restantes";
    message =
      `Seu limite de IA está acabando (${Math.floor(usagePct)}%). ` +
      `${remainingTxt}. Ao atingir 100%, o assistente para.`;
  }

  // Context override: campaigns should not degrade; they should be allowed until block.
  if (args.context === "campaign") {
    if (action === "degrade") {
      action = "allow";
      // still surface warning to UI/admin dashboards
    }
  }

  return {
    action,
    overLimit,
    usagePct,
    severity,
    message,
    thresholds: { warnPct, blockPct },
    snapshot: {
      usedTokens: used,
      limitTokens: limit,
      remainingTokens: remaining,
      monthKey: snap.monthKey,
    },
    policy,
  };
}
