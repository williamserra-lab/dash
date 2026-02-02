// src/app/api/clients/[clientId]/campaigns/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createCampaign, getCampaignsByClient } from "@/lib/campaigns";
import { getBillingSummaryForClient } from "@/lib/billingCore";
import { getEntitlementNumber } from "@/lib/entitlements";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const campaigns = await getCampaignsByClient(clientId);
    return NextResponse.json({ campaigns }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar campanhas:", error);
    return NextResponse.json(
      { error: "Erro interno ao listar campanhas." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const billingSummary = await getBillingSummaryForClient(clientId);
    const billingStatus = String(billingSummary?.billing?.status || "active");
    if (billingStatus === "suspended") {
      return NextResponse.json({ error: "billing_suspended", message: "Conta suspensa por inadimplência. Regularize a mensalidade para criar campanhas." }, { status: 403 });
    }

    const ent = billingSummary?.plan?.entitlements || {};
    const maxCampaigns = getEntitlementNumber(ent, "maxCampaigns", 10);
    const existing = await getCampaignsByClient(clientId);
    if (existing.length >= maxCampaigns) {
      return NextResponse.json({ error: "plan_limit_reached", message: `Limite do plano atingido: máximo de ${maxCampaigns} campanhas.` }, { status: 403 });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const name = String((body as any).name || "").trim();
    // Backward-compat: algumas versões antigas do UI mandavam "messageTemplate".
    const message = String((body as any).message || (body as any).messageTemplate || "").trim();
    const vipOnly = Boolean((body as any).target?.vipOnly);

    const targetFromBody = (body as any).target || {};

    if (!name) {
      return NextResponse.json(
        { error: "Nome da campanha é obrigatório." },
        { status: 400 }
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Mensagem da campanha é obrigatória." },
        { status: 400 }
      );
    }

    const campaign = await createCampaign({
      clientId,
      name,
      message,
      target: {
        contactIds: Array.isArray(targetFromBody.contactIds) ? targetFromBody.contactIds : undefined,
        tagsAny: Array.isArray(targetFromBody.tagsAny) ? targetFromBody.tagsAny : undefined,
        listIds: Array.isArray(targetFromBody.listIds) ? targetFromBody.listIds : undefined,
        vipOnly,
        excludeOptOut: targetFromBody.excludeOptOut === false ? false : true,
        excludeBlocked: targetFromBody.excludeBlocked === false ? false : true,
      },
      media: [],
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar campanha:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar campanha." },
      { status: 500 }
    );
  }
}
