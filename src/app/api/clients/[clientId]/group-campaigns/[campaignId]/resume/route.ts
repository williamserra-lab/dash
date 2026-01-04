export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { resumeGroupCampaign } from "@/lib/groupCampaigns";
import { auditWhatsApp } from "@/lib/whatsappAudit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
) {
  try {
    const { clientId, campaignId } = await params;
    await assertClientActive(clientId);

    const updated = await resumeGroupCampaign(clientId, campaignId);

    await auditWhatsApp({
      clientId,
      action: "group_campaign_resume",
      meta: { campaignId },
    });

    return NextResponse.json({ ok: true, campaign: updated }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: (error as any)?.message || "Erro interno." }, { status: 500 });
  }
}
