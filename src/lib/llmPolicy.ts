// src/lib/llmPolicy.ts
// Central policy engine for LLM governance decisions.
//
// Single source of truth to decide allow / degrade / block based on:
// - clientId monthly usage snapshot
// - stored policy (limits)
// - fixed warning/block thresholds (80% / 100%)
//
// Semantics:
// - action="degrade": avoid LLM calls and keep the product operational via deterministic replies.
// - policy.overLimitMode controls what happens when usage >= 100%:
//    - "block"   => block automation (and campaigns), as hard stop.
//    - "degrade" => keep automation in degraded mode (no LLM) even after 100%.
//
// Important product rule:
// - At 80% usage we already switch to degraded mode (no LLM) to avoid a sudden stop.
//   This gives the client time to react (upgrade / increase limit) before reaching 100%.

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

  // Over-limit behavior is controlled by the policy.
  const overLimitMode = policy.overLimitMode;

  if (limit > 0 && usagePct >= blockPct) {
    overLimit = true;

    if (overLimitMode === "block") {
      action = "block";
      severity = "error";
      message =
        "Limite mensal de créditos de IA atingido (100%). A resposta automática foi suspensa até o próximo ciclo ou upgrade.";
    } else {
      // degrade mode: keep operating without LLM calls
      action = "degrade";
      severity = "error";
      message =
        "Limite mensal de créditos de IA atingido (100%). O assistente está em modo degradado (sem LLM) até o próximo ciclo ou upgrade.";
    }
  } else if (limit > 0 && usagePct >= warnPct) {
    // Preemptive degradation: at 80% we already stop LLM calls to avoid a sudden stop at 100%.
    action = "degrade";
    severity = "warn";
    overLimit = true;

    const remainingTxt = remaining > 0 ? `${formatInt(remaining)} créditos restantes` : "sem créditos restantes";

    message =
      `Seu limite mensal de créditos de IA está perto de ser atingido (${Math.floor(usagePct)}%). ` +
      `${remainingTxt}. O assistente entrou em modo degradado (sem LLM) para evitar parar de surpresa. ` +
      "Ajuste o limite ou faça upgrade em Budget.";
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
