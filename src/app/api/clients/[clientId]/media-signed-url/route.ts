// src/app/api/clients/[clientId]/media-signed-url/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { jsonError, newTraceId } from "@/lib/trace";
import { listMediaByClient } from "@/lib/mediaAssets";
import { r2GetSignedDownloadUrl, getR2ConfigOrNull } from "@/lib/r2";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

function normalizeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function tryGetR2KeyFromAsset(asset: any): string | null {
  if (!asset) return null;

  // Preferência 1: meta.r2Key
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta : null;
  const metaKey = meta?.r2Key;
  if (typeof metaKey === "string" && metaKey.trim()) return metaKey.trim();

  // Preferência 2: url no formato r2://bucket/key (se você decidir usar isso)
  const url = typeof asset.url === "string" ? asset.url.trim() : "";
  if (url.startsWith("r2://")) {
    // r2://<bucket>/<key>
    const rest = url.slice("r2://".length);
    const parts = rest.split("/");
    if (parts.length >= 2) {
      parts.shift(); // bucket
      const key = parts.join("/").trim();
      return key ? key : null;
    }
  }

  return null;
}

// GET /api/clients/:clientId/media-signed-url?key=...&expires=300
// GET /api/clients/:clientId/media-signed-url?assetId=media_xxx&expires=300
export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const traceId = newTraceId("r2dl_");

  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return jsonError(400, {
        traceId,
        errorCode: "MEDIA_SIGNED_URL_CLIENTID_REQUIRED",
        message: "clientId é obrigatório na rota.",
      });
    }

    const cfg = getR2ConfigOrNull();
    if (!cfg) {
      return jsonError(500, {
        traceId,
        errorCode: "MEDIA_SIGNED_URL_R2_NOT_CONFIGURED",
        message: "R2 não está configurado no servidor (env vars ausentes).",
      });
    }

    const keyParam = normalizeString(req.nextUrl.searchParams.get("key"));
    const assetId = normalizeString(req.nextUrl.searchParams.get("assetId"));
    const expiresRaw = normalizeString(req.nextUrl.searchParams.get("expires"));

    let expires = 300;
    if (expiresRaw) {
      const n = Number(expiresRaw);
      if (Number.isFinite(n)) expires = Math.floor(n);
    }
    // segurança: mínimo 30s, máximo 1h
    expires = clamp(expires, 30, 3600);

    let key = keyParam;

    if (!key && assetId) {
      const list = await listMediaByClient(clientId);
      const asset = list.find((m) => m.id === assetId);

      if (!asset) {
        return jsonError(404, {
          traceId,
          errorCode: "MEDIA_SIGNED_URL_ASSET_NOT_FOUND",
          message: "Media asset não encontrado para este cliente.",
          details: { assetId },
        });
      }

      const r2Key = tryGetR2KeyFromAsset(asset);
      if (!r2Key) {
        return jsonError(400, {
          traceId,
          errorCode: "MEDIA_SIGNED_URL_ASSET_HAS_NO_R2_KEY",
          message: "Este asset não possui meta.r2Key (R2) configurado.",
          details: { assetId },
        });
      }

      key = r2Key;
    }

    if (!key) {
      return jsonError(400, {
        traceId,
        errorCode: "MEDIA_SIGNED_URL_KEY_REQUIRED",
        message: "Informe ?key=... (ou ?assetId=... com meta.r2Key).",
      });
    }

    const signed = await r2GetSignedDownloadUrl(
      {
        key,
        expiresInSeconds: expires,
      },
      cfg,
    );

    return NextResponse.json(
      {
        ok: true,
        traceId,
        url: signed.url,
        key: signed.key,
        expiresInSeconds: signed.expiresInSeconds,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[MEDIA-SIGNED-URL] erro:", err);
    return jsonError(500, {
      traceId,
      errorCode: "MEDIA_SIGNED_URL_INTERNAL_ERROR",
      message: "Erro interno ao gerar signed URL.",
      details: { message: err?.message || String(err) },
    });
  }
}
