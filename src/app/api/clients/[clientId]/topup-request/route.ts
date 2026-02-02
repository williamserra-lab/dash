import { NextRequest, NextResponse } from "next/server";
import { createTopupRequest } from "@/lib/topupRequests";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  let body: any = null;
  try {
    body = await req.json().catch(() => null);
  } catch {
    body = null;
  }

  try {
    const row = await createTopupRequest(clientId, {
      source: "client_panel",
      userAgent: req.headers.get("user-agent") || null,
      ip: req.headers.get("x-forwarded-for") || null,
      ...(body && typeof body === "object" ? body : {}),
    });
    return NextResponse.json({ ok: true, request: { id: row.id, status: row.status, requestedAt: row.requested_at } });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: "topup_request_failed", message: msg }, { status: 500 });
  }
}
