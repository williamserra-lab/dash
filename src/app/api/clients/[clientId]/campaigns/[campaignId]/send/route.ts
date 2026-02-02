export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import {
  getCampaignById,
  getEligibleWhatsAppContactsForCampaign,
  getSendsByCampaign,
  markCampaignSent,
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

    // Bloqueio por consumo do plano (tokens) — campanhas não podem disparar quando excede.
    try {
      const decision = await resolveLlmDecision({ clientId, context: "campaign" });
      logTelemetry({ ts: nowIso(), level: "info", event: "llm_policy_decision", clientId, payload: { context: "campaign_send", action: decision.action, overLimit: decision.overLimit, monthKey: decision.snapshot?.monthKey ?? null, used: decision.snapshot?.usedTokens ?? null, limit: decision.policy?.monthlyTokenLimit ?? null } });
      if (decision.action === "block") {
        logTelemetry({ ts: nowIso(), level: "warn", event: "llm_blocked", clientId, payload: { context: "campaign_send", reason: "budget_over_limit" } });
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

    const campaign = await getCampaignById(clientId, campaignId);
    if (!campaign) {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }

    // Pausada: bloqueia disparo (P1)
    if (campaign.status === "pausada") {
      return NextResponse.json({ error: "Campanha está pausada." }, { status: 409 });
    }

    const policy = getWhatsAppOperationalPolicy();

    // Alvos (mesma regra da simulação: contactIds/listIds/tagsAny + flags)
    const targets = await getEligibleWhatsAppContactsForCampaign({
      clientId,
      target: campaign.target,
    });


    // Teto por campanha (segurança)
    const cappedTargets = targets.slice(0, policy.perCampaignMax);

    // Status existente por contato (B: idempotência por destino / retry de erro)
    const existing = await getSendsByCampaign(campaign.id);
    const statusByContact = new Map<string, string>();
    for (const s of existing) statusByContact.set(String(s.contactId), String(s.status));

    // Calcula o conjunto elegível: pula agendado/enviado, permite erro (retry)
    const eligible = cappedTargets.filter((c) => {
      const st = statusByContact.get(String(c.id));
      if (st === "agendado" || st === "enviado") return false;
      return true; // inclui erro e undefined
    });

    const skippedAlreadyHandled = Math.max(0, cappedTargets.length - eligible.length);

    // Limite diário (PARCIAL)
    const quota = await reserveDailyQuota({ clientId, desired: eligible.length });
    const allowed = eligible.slice(0, quota.allowed);
    const skippedDueToDailyLimit = Math.max(0, eligible.length - allowed.length);

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

        // Marca o envio como "agendado" para garantir idempotência e refletir no dashboard.
        await recordCampaignSendStatus({
          campaignId: campaign.id,
          clientId,
          contactId: contact.id,
          identifier: contact.identifier,
          status: "agendado",
        });

        enqueued += 1;
      } catch (err) {
        errors += 1;
        // Best-effort: registra o erro no dashboard para permitir retry.
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

    const updated = await markCampaignSent(
      campaign,
      skippedDueToDailyLimit > 0 ? "em_andamento" : "disparada"
    );

    await auditWhatsApp({
      clientId,
      action: "campaign_send",
      meta: {
        campaignId: updated.id,
        totalTargets: targets.length,
        cappedTargets: cappedTargets.length,
        eligible: eligible.length,
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
      correlationId: `campaign:${updated.id}`,
      payload: {
        campaignId: updated.id,
        clientId,
        totalTargets: targets.length,
        enqueued,
        skippedDueToDailyLimit,
      },
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      {
        ok: true,
        mode: "send",
        clientId,
        campaignId: updated.id,
        statusAfter: updated.status,
        summary: {
          totalTargets: targets.length,
          cappedTargets: cappedTargets.length,
          eligible: eligible.length,
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
        campaign: updated,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao enviar campanha:", error);
    return NextResponse.json(
      { error: (error as any)?.message || "Erro interno ao enviar campanha." },
      { status: 500 }
    );
  }
}
