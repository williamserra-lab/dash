import { NextRequest, NextResponse } from "next/server";
import { listEventsByCorrelationId } from "@/lib/analytics";

// Note: In Next.js route handlers, DO NOT export helpers. Only export HTTP methods.
// Admin gating is expected to be enforced by existing admin middleware / proxy.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") || undefined;
  const correlationId = url.searchParams.get("correlationId") || "";
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw || "200", 10) || 200, 1), 500);

  if (!correlationId.trim()) {
    return NextResponse.json({ ok: false, error: "missing_correlationId" }, { status: 400 });
  }

  const events = await listEventsByCorrelationId({ clientId, correlationId, limit });
  return NextResponse.json({ ok: true, correlationId, events });
}
