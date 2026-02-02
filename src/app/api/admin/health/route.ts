import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { dbQuery, isDbEnabled } from "@/lib/db";
import { getEvolutionConfig } from "@/lib/evolutionConfig";
import { evolutionFindMessages } from "@/lib/evolutionApi";
import { jsonError, newTraceId } from "@/lib/trace";

export const runtime = "nodejs";

type Check = { ok: boolean; details?: any };

async function checkDb(traceId: string): Promise<Check> {
  if (!isDbEnabled()) {
    return { ok: false, details: { errorCode: "DB_DISABLED", message: "NEXTIA_DB_URL ausente." } };
  }

  try {
    await dbQuery("select 1 as ok");

    // “Integridade mínima”: verifica se tabelas críticas existem.
    // (Se migrations não rodaram, essas queries falham e a resposta sai como ok:false.)
    await dbQuery("select 1 from nextia_timeline_events limit 1");
    await dbQuery("select 1 from nextia_outbox limit 1");
    await dbQuery("select 1 from nextia_messages limit 1");

    const queued = await dbQuery<{ cnt: string }>("select count(*)::text as cnt from nextia_outbox where status = $1", [
      "queued",
    ]);

    return {
      ok: true,
      details: {
        queuedOutbox: Number(queued.rows?.[0]?.cnt || "0"),
      },
    };
  } catch (err: any) {
    return { ok: false, details: { message: String(err?.message || err) } };
  }
}

async function checkEvolution(traceId: string): Promise<Check> {
  const cfg = getEvolutionConfig();
  if (!cfg) return { ok: false, details: { errorCode: "EVOLUTION_ENV_MISSING", message: "EVOLUTION_* não configurado." } };

  // Optional auth-level check: requires a real remoteJid/number to query.
  const remoteJid = String(process.env.NEXTIA_HEALTHCHECK_REMOTE_JID || "").trim();
  if (!remoteJid) {
    return { ok: true, details: { note: "Sem NEXTIA_HEALTHCHECK_REMOTE_JID; só checagem via /api/health (reachability)." } };
  }

  try {
    const res = await evolutionFindMessages(cfg, { remoteJid, limit: 1 });
    const total = Number(res?.messages?.total || 0);
    return { ok: true, details: { queriedRemoteJid: remoteJid, messagesTotal: total } };
  } catch (err: any) {
    return { ok: false, details: { message: String(err?.message || err) } };
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const traceId = newTraceId("ops_trc_");

  try {
    const db = await checkDb(traceId);
    const evolution = await checkEvolution(traceId);

    const ok = Boolean(db.ok && evolution.ok);

    const payload = {
      ok,
      traceId,
      db,
      evolution,
      env: {
        dbEnabled: isDbEnabled(),
        evolutionConfigured: Boolean(getEvolutionConfig()),
        outboxSendImmediate: String(process.env.OUTBOX_SEND_IMMEDIATE || "").trim() || "false",
      },
    };

    return NextResponse.json(payload, { status: ok ? 200 : 503 });
  } catch (err: any) {
    console.error("[admin.health]", { traceId, errorCode: "ADMIN_HEALTH_ERROR", err });
    return jsonError(500, {
      traceId,
      errorCode: "ADMIN_HEALTH_ERROR",
      message: "Falha ao executar healthcheck administrativo.",
      details: { message: String(err?.message || err) },
    });
  }
}
