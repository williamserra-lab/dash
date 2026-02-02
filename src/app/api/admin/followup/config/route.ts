import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { newTraceId, jsonError } from "@/lib/trace";
import { getFollowupV2Config, updateFollowupV2Config } from "@/lib/followupV2Config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const traceId = newTraceId("fu_cfg_");
  try {
    const url = new URL(req.url);
    const clientId = String(url.searchParams.get("clientId") || "").trim();
    if (!clientId) return jsonError(400, { traceId, errorCode: "FOLLOWUP_CLIENTID_REQUIRED", message: "clientId é obrigatório." });

    const cfg = await getFollowupV2Config(clientId);
    return NextResponse.json({ ok: true, traceId, config: cfg });
  } catch (err: any) {
    console.error("[followup.config.get]", { traceId, err });
    return jsonError(500, { traceId, errorCode: "FOLLOWUP_CONFIG_GET_ERROR", message: "Falha ao ler config.", details: { message: String(err?.message || err) } });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const traceId = newTraceId("fu_cfg_");
  try {
    const url = new URL(req.url);
    const clientId = String(url.searchParams.get("clientId") || "").trim();
    if (!clientId) return jsonError(400, { traceId, errorCode: "FOLLOWUP_CLIENTID_REQUIRED", message: "clientId é obrigatório." });

    const body = await req.json().catch(() => ({}));
    const cfg = await updateFollowupV2Config({ clientId, patch: body || {} });
    return NextResponse.json({ ok: true, traceId, config: cfg });
  } catch (err: any) {
    console.error("[followup.config.post]", { traceId, err });
    return jsonError(500, { traceId, errorCode: "FOLLOWUP_CONFIG_SAVE_ERROR", message: "Falha ao salvar config.", details: { message: String(err?.message || err) } });
  }
}
