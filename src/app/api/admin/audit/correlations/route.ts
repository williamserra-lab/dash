import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listRecentCorrelations } from "@/lib/analytics";

// Note: In Next.js route handlers, DO NOT export helpers. Only export HTTP methods.
// Admin gating is expected to be enforced by existing admin middleware / proxy.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") || undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitRaw || "50", 10) || 50, 1), 200);

  const rows = await listRecentCorrelations({ clientId, limit });
  return NextResponse.json({ ok: true, correlations: rows });
}
