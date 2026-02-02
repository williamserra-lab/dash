// src/app/api/clients/[clientId]/group-campaigns/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getBillingSummaryForClient } from "@/lib/billingCore";
import { getEntitlementNumber } from "@/lib/entitlements";
import { createGroupCampaign, listGroupCampaigns } from "@/lib/groupCampaigns";
import { listAuthorizedGroupsByClient } from "@/lib/whatsappGroups";

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

async function enforceClientAndPlanLimits(clientId: string): Promise<{ maxGroupCampaigns: number }> {
  const summary = await getBillingSummaryForClient(clientId);
  const status = String(summary?.billing?.status || "active");
  if (status === "suspended") {
    const reason = summary?.billing?.suspendedReason ? String(summary.billing.suspendedReason) : "";
    throw new Error(`CLIENT_SUSPENDED:${reason || "billing"}`);
  }

  const ent = summary?.plan?.entitlements || {};
  const maxGroupCampaigns = getEntitlementNumber(ent, "maxCampaigns", 10);
  return { maxGroupCampaigns };
}

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    // Enforce billing status (DB)
    await enforceClientAndPlanLimits(clientId);

    const campaigns = await listGroupCampaigns(clientId);
    return NextResponse.json({ ok: true, campaigns }, { status: 200 });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.startsWith("CLIENT_SUSPENDED:")) {
      return NextResponse.json(
        { error: "Cliente suspenso por billing. Regularize o pagamento para liberar campanhas." },
        { status: 403 }
      );
    }
    console.error("Erro ao listar campanhas de grupos:", error);
    return NextResponse.json({ error: "Erro interno ao listar campanhas." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    const { maxGroupCampaigns } = await enforceClientAndPlanLimits(clientId);

    // Plan limit: max campaigns
    const existing = await listGroupCampaigns(clientId);
    const activeCount = existing.filter((c: any) => c && c.status !== "cancelada").length;
    if (activeCount >= maxGroupCampaigns) {
      return NextResponse.json(
        {
          error: "plan_limit_reached",
          message: `Limite de campanhas do seu plano atingido (max ${maxGroupCampaigns}).`,
        },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name || "").trim();
    const message = String(body.message || "").trim();
    const paceProfile = (body.paceProfile || "safe") as any;
    const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String) : [];

    if (!name) return NextResponse.json({ error: "Nome da campanha é obrigatório." }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Mensagem é obrigatória." }, { status: 400 });
    if (!groupIds.length) return NextResponse.json({ error: "Selecione ao menos 1 grupo." }, { status: 400 });

    // Segurança: só permite grupos previamente autorizados
    const authorized = await listAuthorizedGroupsByClient(clientId);
    const allowed = new Set(authorized.map((g) => g.groupId));
    const filtered = groupIds.filter((gid: string) => allowed.has(String(gid).trim()));

    if (!filtered.length) {
      return NextResponse.json(
        { error: "Nenhum dos grupos selecionados está autorizado para campanhas." },
        { status: 400 }
      );
    }

    const campaign = await createGroupCampaign({
      clientId,
      name,
      message,
      groupIds: filtered,
      paceProfile,
    });

    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.startsWith("CLIENT_SUSPENDED:")) {
      return NextResponse.json(
        { error: "Cliente suspenso por billing. Regularize o pagamento para liberar campanhas." },
        { status: 403 }
      );
    }
    console.error("Erro ao criar campanha de grupos:", error);
    return NextResponse.json({ error: error?.message || "Erro interno ao criar campanha." }, { status: 500 });
  }
}
