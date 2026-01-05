// src/app/api/clients/[clientId]/campaigns/[campaignId]/simulate/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { simulateCampaign } from "@/lib/campaigns";
import { logAnalyticsEvent } from "@/lib/analytics";
void assertClientActive;

type RouteContext = {
  params: Promise<{
    clientId: string;
    campaignId: string;
  }>;
};

export async function POST(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId, campaignId } = await context.params;
    if (!clientId || !campaignId) {
      return NextResponse.json(
        { error: "clientId e campaignId são obrigatórios." },
        { status: 400 }
      );
    }

    const campaign = await simulateCampaign(campaignId);
    if (!campaign || campaign.clientId !== clientId) {
      return NextResponse.json(
        { error: "Campanha não encontrada." },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    await logAnalyticsEvent({
      type: "campaign_simulated",
      clientId,
      contactId: null,
      identifier: null,
      correlationId: `campaign:${campaign.id}`,
      payload: {
        campaignId: campaign.id,
        clientId,
        totalContacts: campaign.simulation?.totalContacts ?? null,
        eligibleContacts: campaign.simulation?.eligibleContacts ?? null,
        vipContacts: campaign.simulation?.vipContacts ?? null,
      },
      createdAt: now,
    });

    return NextResponse.json({ campaign }, { status: 200 });
  } catch (error) {
    
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
console.error("Erro ao simular campanha:", error);
    return NextResponse.json(
      { error: "Erro interno ao simular campanha." },
      { status: 500 }
    );
  }
}