// src/lib/llmPolicy.ts
// Central policy engine for LLM governance decisions.
//
// Goal: single source of truth to decide allow / degrade / block based on:
// - clientId monthly usage snapshot
// - stored policy (overLimitMode, limits)

import { getBudgetSnapshot, getPolicyForClient, type LlmBudgetPolicy } from "@/lib/llmBudget";

export type LlmContext = "inbound" | "campaign";

export type LlmDecisionAction = "allow" | "degrade" | "block";

export type LlmDecision = {
  action: LlmDecisionAction;
  overLimit: boolean;
  snapshot: {
    usedTokens: number;
    limitTokens: number;
    remainingTokens: number;
    monthKey: string;
  };
  policy: LlmBudgetPolicy;
};

/**
 * Decide what to do with LLM usage for a given context.
 *
 * Project rule (as per agreed direction):
 * - Inbound atendimento: degrade when over limit (never block inbound).
 * - Campanhas: default behavior is block when over limit (can be overridden to degrade via policy).
 */
export async function resolveLlmDecision(args: {
  clientId: string;
  context: LlmContext;
}): Promise<LlmDecision> {
  const { clientId, context } = args;

  const [snap, policy] = await Promise.all([
    getBudgetSnapshot(clientId),
    getPolicyForClient(clientId),
  ]);

  const overLimit = snap.usedTokens >= snap.limitTokens;

  let action: LlmDecisionAction = "allow";

  if (overLimit) {
    if (context === "inbound") {
      // Never block inbound. If budget is exceeded, we degrade deterministically.
      action = "degrade";
    } else {
      // campaign
      action = policy.overLimitMode === "degrade" ? "degrade" : "block";
    }
  }

  return {
    action,
    overLimit,
    snapshot: {
      usedTokens: snap.usedTokens,
      limitTokens: snap.limitTokens,
      remainingTokens: Math.max(0, snap.limitTokens - snap.usedTokens),
      monthKey: snap.monthKey,
    },
    policy,
  };
}
