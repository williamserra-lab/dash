export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { simulateGroupCampaign, getGroupCampaignById } from "@/lib/groupCampaigns";
import { appendMarketingOptOutFooter } from "@/lib/marketingOptOut";
void assertClientActive;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
): Promise<NextResponse> {
  try {
    const { clientId, campaignId } = await params;
    await assertClientActive(clientId);

    const existing = await getGroupCampaignById(clientId, campaignId);
    if (!existing) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

    const updated = await simulateGroupCampaign(clientId, campaignId);
    if (!updated) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });

    const effectiveMessage = appendMarketingOptOutFooter(updated.message);
    return NextResponse.json({ ok: true, campaign: updated, effectiveMessage }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Erro ao simular campanha de grupos:", error);
    return NextResponse.json({ error: "Erro interno ao simular campanha." }, { status: 500 });
  }
}
