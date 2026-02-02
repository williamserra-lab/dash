import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { newTraceId, jsonError } from "@/lib/trace";
import { runFollowupV2 } from "@/lib/followupV2Runner";

export const runtime = "nodejs";

function parseLimit(raw: string | null): number {
  const n = parseInt(raw || "", 10);
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(Math.max(n, 1), 100);
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const traceId = newTraceId("fu_trc_");

  try {
    const url = new URL(req.url);
    const clientId = String(url.searchParams.get("clientId") || "").trim();
    if (!clientId) return jsonError(400, { traceId, errorCode: "FOLLOWUP_CLIENTID_REQUIRED", message: "clientId é obrigatório." });

    const dryRun = url.searchParams.get("dryRun") === "1";
    const send = url.searchParams.get("send") === "1";
    if ((dryRun && send) || (!dryRun && !send)) {
      return jsonError(400, {
        traceId,
        errorCode: "FOLLOWUP_MODE_REQUIRED",
        message: "Informe exatamente um modo: dryRun=1 OU send=1.",
      });
    }

    const limit = parseLimit(url.searchParams.get("limit"));

    const result = await runFollowupV2({
      clientId,
      traceId,
      mode: dryRun ? "dryRun" : "send",
      limit,
      ultraSafe: true,
      // Ultra safe: dryRun sem efeitos colaterais (não grava métricas).
      recordDryRunMetrics: false,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[followup.run]", { traceId, errorCode: "FOLLOWUP_RUN_ERROR", err });
    return jsonError(500, {
      traceId,
      errorCode: "FOLLOWUP_RUN_ERROR",
      message: "Falha ao executar o runner de follow-up.",
      details: { message: String(err?.message || err) },
    });
  }
}
