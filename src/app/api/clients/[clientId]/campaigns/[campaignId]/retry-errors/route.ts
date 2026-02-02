export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import {
  getCampaignById,
  getEligibleWhatsAppContactsForCampaign,
  getSendsByCampaign,
  recordCampaignSendStatus,
} from "@/lib/campaigns";
import { sendWhatsappCampaignMessage } from "@/lib/whatsapp";
import { logAnalyticsEvent } from "@/lib/analytics";
import { reserveDailyQuota } from "@/lib/whatsappDailyLimits";
import { getWhatsAppOperationalPolicy } from "@/lib/whatsappOperationalPolicy";
import { buildNotBeforeSchedule, computeFirstNotBefore } from "@/lib/whatsappSchedule";
import { auditWhatsApp } from "@/lib/whatsappAudit";
import { resolveLlmDecision } from "@/lib/llmPolicy";
import { logTelemetry, nowIso } from "@/lib/telemetry";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
) {
  try {
    const { clientId, campaignId } = await params;
    await assertClientActive(clientId);

    // Bloqueio por consumo do plano (tokens)
    try {
      const decision = await resolveLlmDecision({ clientId, context: "campaign" });
      logTelemetry({
        ts: nowIso(),
        level: "info",
        event: "llm_policy_decision",
        clientId,
        payload: {
          context: "campaign_retry_errors",
          action: decision.action,
          overLimit: decision.overLimit,
          monthKey: decision.snapshot?.monthKey ?? null,
          used: decision.snapshot?.usedTokens ?? null,
          limit: decision.policy?.monthlyTokenLimit ?? null,
        },
      });
      if (decision.action === "block") {
        logTelemetry({
          ts: nowIso(),
          level: "warn",
          event: "llm_blocked",
          clientId,
          payload: { context: "campaign_retry_errors", reason: "budget_over_limit" },
        });
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
// best-effort
    }

    const campaign = await getCampaignById(clientId, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }

    if (campaign.status === "cancelada") {
      return NextResponse.json(
        { error: "Campanha cancelada não pode ter erros reprocessados." },
        { status: 400 }
      );
    }
    if (campaign.status === "pausada") {
      return NextResponse.json(
        { error: "Campanha pausada. Retome (resume) antes de reenviar erros." },
        { status: 400 }
      );
    }

    const policy = getWhatsAppOperationalPolicy();

    // Alvos elegíveis (mesma regra da simulação/envio)
    const targets = await getEligibleWhatsAppContactsForCampaign({
      clientId,
      target: campaign.target,
    });

    // Teto por campanha (segurança)
    const cappedTargets = targets.slice(0, policy.perCampaignMax);

    // Filtra SOMENTE contatos com status "erro" (decisão A: mensagem sempre a da campanha; decisão B anterior: resume não reenvia erro)
    const sends = await getSendsByCampaign(campaign.id);
    const errorContactIds = new Set<string>();
    for (const s of sends) {
      if (String(s.status) === "erro") errorContactIds.add(String(s.contactId));
    }

    const retryTargets = cappedTargets.filter((c) => errorContactIds.has(String(c.id)));

    const skippedAlreadyHandled = Math.max(0, cappedTargets.length - retryTargets.length);

    // Limite diário
    const quota = await reserveDailyQuota({ clientId, desired: retryTargets.length });
    const allowed = retryTargets.slice(0, quota.allowed);
    const skippedDueToDailyLimit = Math.max(0, retryTargets.length - allowed.length);

    // Agenda notBefore em janela + pacing
    const first = computeFirstNotBefore(new Date());
    const schedule = buildNotBeforeSchedule({
      count: allowed.length,
      profile: policy.defaultPaceProfile,
      startAt: first,
    });

    let enqueued = 0;
    let errors = 0;
    for (let i = 0; i < allowed.length; i++) {
      const contact = allowed[i];
      const notBefore = schedule[i] ?? null;

      try {
        await sendWhatsappCampaignMessage(
          clientId,
          campaign.id,
          contact,
          campaign.message,
          {
            notBefore,
            idempotencyKey: `cmp:${campaign.id}:contact:${contact.id}`,
            allowRetryOnError: true,
          }
        );

        await recordCampaignSendStatus({
          campaignId: campaign.id,
          clientId,
          contactId: contact.id,
          identifier: contact.identifier,
          status: "agendado",
        });

        enqueued += 1;
      } catch {
        errors += 1;
        // Mantém/registrar erro (best-effort)
        try {
          await recordCampaignSendStatus({
            campaignId: campaign.id,
            clientId,
            contactId: contact.id,
            identifier: contact.identifier,
            status: "erro",
          });
        } catch {
        errors += 1;
          // silencioso
        }
      }
    }

    await auditWhatsApp({
      clientId,
      action: "campaign_retry_errors",
      meta: {
        campaignId: campaign.id,
        totalTargets: targets.length,
        cappedTargets: cappedTargets.length,
        retryErrors: retryTargets.length,
        enqueued,
        skippedDueToDailyLimit,
        daily: {
          date: quota.date,
          limit: quota.limit,
          usedAfter: quota.usedAfter,
        },
      },
    });

    await logAnalyticsEvent({
      type: "campaign_sent",
      clientId,
      contactId: null,
      identifier: null,
      correlationId: `campaign:${campaign.id}`,
      payload: {
        campaignId: campaign.id,
        clientId,
        mode: "retry_errors",
        retryErrors: retryTargets.length,
        enqueued,
        skippedDueToDailyLimit,
      },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        mode: "retry_errors",
        clientId,
        campaignId: campaign.id,
        statusAfter: campaign.status,
        summary: {
          totalTargets: targets.length,
          cappedTargets: cappedTargets.length,
          eligible: retryTargets.length,
          attempted: allowed.length,
          enqueued,
          errors,
          skippedAlreadyHandled,
          skippedDueToDailyLimit,
        },
        daily: {
          date: quota.date,
          limit: quota.limit,
          usedAfter: quota.usedAfter,
          remainingAfter: quota.remainingAfter,
        },
        campaign,
      },
      { status: 200 }
    );
  } catch (err) {
if (err instanceof ClientAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}