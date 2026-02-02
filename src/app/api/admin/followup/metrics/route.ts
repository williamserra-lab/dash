import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { newTraceId, jsonError } from "@/lib/trace";
import { listFollowupMetricEvents, computeFollowupMetricSummary } from "@/lib/followupV2Metrics";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const traceId = newTraceId("fu_met_");
  try {
    const url = new URL(req.url);
    const clientId = String(url.searchParams.get("clientId") || "").trim();
    if (!clientId) return jsonError(400, { traceId, errorCode: "FOLLOWUP_CLIENTID_REQUIRED", message: "clientId é obrigatório." });

    const limitRaw = url.searchParams.get("limit");
    const limit = Math.min(Math.max(parseInt(limitRaw || "500", 10) || 500, 50), 2000);

    const events = await listFollowupMetricEvents({ clientId, limit });
    const summary = computeFollowupMetricSummary(clientId, events);

    return NextResponse.json({ ok: true, traceId, summary, events });
  } catch (err: any) {
    console.error("[followup.metrics.get]", { traceId, err });
    return jsonError(500, { traceId, errorCode: "FOLLOWUP_METRICS_ERROR", message: "Falha ao ler métricas.", details: { message: String(err?.message || err) } });
  }
}
