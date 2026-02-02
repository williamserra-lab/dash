import { NextRequest, NextResponse } from "next/server";
import { getBillingSummaryForClient } from "@/lib/billingCore";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  try {
    const summary = await getBillingSummaryForClient(clientId);
    return NextResponse.json(summary);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.startsWith("client_not_found") ? 404 : 500;
    return NextResponse.json({ error: "billing_error", message: msg }, { status: code });
  }
}
