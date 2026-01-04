export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { pauseCampaign } from "@/lib/campaigns";
import { cancelPendingWhatsappOutboxByCampaign } from "@/lib/whatsappOutboxStore";
import { auditWhatsApp } from "@/lib/whatsappAudit";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; campaignId: string }> }
) {
  try {
    const { clientId, campaignId } = await params;
    await assertClientActive(clientId);

    const updated = await pauseCampaign(clientId, campaignId);
    const canceled = await cancelPendingWhatsappOutboxByCampaign({
      clientId,
      campaignId,
    });

    await auditWhatsApp({
      clientId,
      action: "campaign_pause",
      meta: { campaignId, canceledPending: canceled.canceled },
    });

    return NextResponse.json({ ok: true, campaign: updated, canceledPending: canceled.canceled }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: (error as any)?.message || "Erro interno." }, { status: 500 });
  }
}
