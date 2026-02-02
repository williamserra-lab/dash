export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getSendsByCampaign } from "@/lib/campaigns";

type RouteContext = {
  params: Promise<{ clientId: string; campaignId: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, campaignId } = await context.params;
    await assertClientActive(clientId);

    const sends = await getSendsByCampaign(String(campaignId || "").trim());

    // devolve apenas campos necessários pro painel
    const items = sends
      .filter((s) => String(s.clientId || "") === String(clientId || ""))
      .map((s: any) => ({
        id: s.id,
        contactId: s.contactId,
        identifier: s.identifier,
        status: s.status,
        createdAt: s.createdAt,
        scheduledAt: s.scheduledAt ?? null,
        sentAt: s.sentAt ?? null,
        firstReplyAt: s.firstReplyAt ?? null,
        replied24h: Boolean(s.replied24h),
        replied7d: Boolean(s.replied7d),
      }));

    return NextResponse.json({ sends: items }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao carregar resultados da campanha:", error);
    return NextResponse.json({ error: "Erro interno ao carregar resultados da campanha." }, { status: 500 });
  }
}
