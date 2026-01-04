// src/app/api/clients/[clientId]/campaigns/dashboard/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getCampaignDashboardByClient } from "@/lib/campaigns";

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

    const items = await getCampaignDashboardByClient(String(clientId || "").trim());
    return NextResponse.json({ campaigns: items }, { status: 200 });
  } catch (error) {
    console.error("Erro ao carregar dashboard de campanhas:", error);
    return NextResponse.json(
      { error: "Erro interno ao carregar dashboard de campanhas." },
      { status: 500 }
    );
  }
}
