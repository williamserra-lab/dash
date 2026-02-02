import { NextRequest, NextResponse } from "next/server";
import { dbQuery, isDbEnabled } from "@/lib/db";
import { jsonError, newTraceId } from "@/lib/trace";

export const runtime = "nodejs";

function hasEvolutionConfigured(): boolean {
  return Boolean(String(process.env.EVOLUTION_BASE_URL || "").trim());
}

async function checkEvolutionReachability(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const baseUrl = String(process.env.EVOLUTION_BASE_URL || "").trim();
  if (!baseUrl) return { ok: true };

  const controller = new AbortController();
  const timeoutMs = Math.max(500, Math.min(10000, Number(process.env.NEXTIA_HEALTH_EVOLUTION_TIMEOUT_MS || "2000")));
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Cheap reachability check (does not send any WhatsApp message).
    const res = await fetch(baseUrl, { method: "GET", signal: controller.signal });
    return { ok: res.ok || (res.status >= 200 && res.status < 500), status: res.status };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const traceId = newTraceId("hc_trc_");

  try {
    // DB is mandatory for production: missing DB => loud failure (503).
    if (!isDbEnabled()) {
      return jsonError(503, {
        traceId,
        errorCode: "HEALTH_DB_DISABLED",
        message: "DB não habilitado (NEXTIA_DB_URL ausente).",
      });
    }

    // Minimal DB liveness + schema readiness.
    await dbQuery("select 1 as ok");

    const evo = await checkEvolutionReachability();
    if (hasEvolutionConfigured() && !evo.ok) {
      return jsonError(503, {
        traceId,
        errorCode: "HEALTH_EVOLUTION_UNREACHABLE",
        message: "Evolution não acessível pelo NextIA.",
        details: { status: evo.status, error: evo.error },
      });
    }

    return NextResponse.json({
      ok: true,
      traceId,
      db: { ok: true },
      evolution: hasEvolutionConfigured() ? evo : { ok: true, configured: false },
    });
  } catch (err: any) {
    console.error("[health]", { traceId, errorCode: "HEALTH_ERROR", err });
    return jsonError(503, {
      traceId,
      errorCode: "HEALTH_ERROR",
      message: "Falha no healthcheck do NextIA.",
      details: { message: String(err?.message || err) },
    });
  }
}
