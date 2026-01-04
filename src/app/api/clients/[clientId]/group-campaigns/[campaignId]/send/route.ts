export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getGroupCampaignById, enqueueGroupCampaignToOutbox, markGroupCampaignSent } from "@/lib/groupCampaigns";
import { listAuthorizedGroupsByClient } from "@/lib/whatsappGroups";
import { createRun, setRunStatus } from "@/lib/campaignRuns";
import { auditWhatsApp } from "@/lib/whatsappAudit";
import { appendMarketingOptOutFooter } from "@/lib/marketingOptOut";
import { resolveLlmDecision } from "@/lib/llmPolicy";
import { logTelemetry, nowIso } from "@/lib/telemetry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
): Promise<NextResponse> {
  let runId: string | null = null;
  let clientIdForRun: string | null = null;
  try {
    const { clientId, campaignId } = await params;
    clientIdForRun = clientId;

    await assertClientActive(clientId);

    // Bloqueio por consumo do plano (tokens) — campanhas não podem disparar quando excede.
    try {
      const decision = await resolveLlmDecision({ clientId, context: "campaign" });
      logTelemetry({ ts: nowIso(), level: "info", event: "llm_policy_decision", clientId, payload: { context: "group_campaign_send", action: decision.action, overLimit: decision.overLimit, monthKey: decision.snapshot?.monthKey ?? null, used: decision.snapshot?.usedTokens ?? null, limit: decision.policy?.monthlyTokenLimit ?? null } });
      if (decision.action === "block") {
        logTelemetry({ ts: nowIso(), level: "warn", event: "llm_blocked", clientId, payload: { context: "group_campaign_send", reason: "budget_over_limit" } });
        return NextResponse.json(
          {
            error: "Limite do plano atingido. Campanhas estão bloqueadas.",
            code: "budget_over_limit",
            snapshot: decision.snapshot,
          },
          { status: 402 }
        );
      }
    } catch {
      // Se não conseguimos ler budget/policy, não bloqueamos (best-effort).
    }

    const campaign = await getGroupCampaignById(clientId, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }

    // Apenas grupos autorizados
    const authorized = await listAuthorizedGroupsByClient(clientId);
    const allowedIds = new Set((authorized || []).map((g) => String(g.groupId)));

    const groupIds = (campaign.groupIds || []).map(String).filter((id) => allowedIds.has(id));

    if (!groupIds.length) {
      return NextResponse.json({ error: "Nenhum grupo autorizado para esta campanha." }, { status: 400 });
    }

// Step 24.1: registra execução (run) para auditoria e UI.
const run = await createRun({
  clientId,
  campaignId: campaign.id,
  kind: "group",
  totalTargets: groupIds.length,
});
runId = run.id;
await setRunStatus({
  clientId,
  runId: run.id,
  status: "sending",
  startedAt: nowIso(),
});

    // Força aviso de opt-out em TODA campanha (mesmo em grupos).
    // Observação: nesta fase, inbound em grupo continua ignorado; o opt-out efetivo acontece no 1:1.
    const effectiveMessage = appendMarketingOptOutFooter(campaign.message);

    const result = await enqueueGroupCampaignToOutbox({
      runId: run.id,
      clientId,
      campaignId: campaign.id,
      groupIds,
      message: effectiveMessage,
      paceProfile: campaign.paceProfile,
    });

    
await setRunStatus({
  clientId,
  runId: run.id,
  status: "done",
  finishedAt: nowIso(),
  enqueued: result.enqueued,
});
const updated = await markGroupCampaignSent(clientId, campaign.id);

    await auditWhatsApp({
      clientId,
      action: "group_campaign_send_requested",
      meta: {
        campaignId: campaign.id,
        enqueued: result.enqueued,
        groupCount: groupIds.length,
      },
    });

    return NextResponse.json({ ok: true, campaign: updated, enqueued: result.enqueued }, { status: 200 });
  } catch (error) {
  // Step 24.1: se falhou após criar run, marque como failed (best-effort).
  if (runId && clientIdForRun) {
    try {
      await setRunStatus({
        clientId: clientIdForRun,
        runId,
        status: "failed",
        finishedAt: nowIso(),
        lastError: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // ignore
    }
  }

    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao enviar campanha de grupos:", error);
    return NextResponse.json(
      { error: (error as any)?.message || "Erro interno ao enviar campanha." },
      { status: 500 }
    );
  }
}