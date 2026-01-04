// src/app/api/clients/[clientId]/media-assets/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import path from "path";
import fs from "fs/promises";
import {
  getDirectorySizeBytes,
  getMaxFileBytes,
  getMaxTotalBytes,
} from "@/lib/storageLimits";

import {
  MediaAsset,
  MediaCategory,
  MediaType,
  listMediaByClient,
  upsertMediaAsset,
  deleteMediaAsset,
} from "@/lib/mediaAssets";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

const UPLOAD_BASE_DIR = path.join(process.cwd(), "public", "uploads", "media");

function getClientDir(clientId: string) {
  return path.join(UPLOAD_BASE_DIR, clientId);
}

async function getClientUsedBytes(clientId: string): Promise<number> {
  const dir = getClientDir(clientId);
  return getDirectorySizeBytes(dir);
}


function createMediaId() {
  const r1 = Math.random().toString(36).slice(2, 8);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `media_${r1}_${r2}`;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseAllowedIntents(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => normalizeString(v)).filter((v) => v.length > 0);
  }

  if (typeof raw === "string") {
    return raw
      .split(/[,\n;]+/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  return [];
}

function isValidCategory(value: string): MediaCategory {
  const v = value.trim() as MediaCategory;
  if (!v) return "outro";
  return v;
}

function isValidType(value: string): MediaType {
  const v = value.trim() as MediaType;
  if (!v) return "pdf";
  return v;
}

// GET /api/clients/:clientId/media-assets
export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório na rota." }, { status: 400 });
    }

    const media = await listMediaByClient(clientId);

    const usedBytes = await getClientUsedBytes(clientId);
    const limitBytes = getMaxTotalBytes();
    const maxFileBytes = getMaxFileBytes();

    return NextResponse.json(
      { media, quota: { usedBytes, limitBytes, maxFileBytes } },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("Erro ao listar media assets:", error);
    return NextResponse.json({ error: "Erro interno ao listar media assets." }, { status: 500 });
  }
}

// POST /api/clients/:clientId/media-assets
export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório na rota." }, { status: 400 });
    }

    const body = await readJsonObject(req);

    const idRaw = normalizeString(body.id);
    const label = normalizeString(body.label);
    const url = normalizeString(body.url);
    const category = isValidCategory(normalizeString(body.category));
    const type = isValidType(normalizeString(body.type));
    const enabled = normalizeBoolean(body.enabled, true);
    const allowedIntents = parseAllowedIntents(body.allowedIntents);
    const meta = body.meta && typeof body.meta === "object" ? body.meta : undefined;

    if (!label) return NextResponse.json({ error: "Label (nome amigável) é obrigatório." }, { status: 400 });
    if (!url) return NextResponse.json({ error: "URL é obrigatória." }, { status: 400 });

    const now = new Date().toISOString();
    const existingList = await listMediaByClient(clientId);
    const existing =
      idRaw && existingList.find((m) => m.id === idRaw)
        ? existingList.find((m) => m.id === idRaw)
        : null;

    const id = idRaw || createMediaId();

    const version =
      typeof body.version === "number"
        ? body.version
        : existing
          ? (existing.version ?? 1)
          : 1;

    const asset: MediaAsset = {
      id,
      clientId,
      category,
      label,
      type,
      url,
      enabled,
      allowedIntents: allowedIntents.length ? allowedIntents : undefined,
      version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      meta,
    };

    const saved = await upsertMediaAsset(asset);

    // Garantir unicidade: apenas uma tabela oficial por cliente
    if (saved?.meta && typeof saved.meta === "object") {
      const savedMeta = saved.meta as Record<string, unknown>;
      if (Boolean(savedMeta.priceTableOfficial)) {
        const all = await listMediaByClient(clientId);
        const others = all.filter((m) => {
          if (m.id === saved.id) return false;
          const metaObj = m.meta && typeof m.meta === "object" ? (m.meta as Record<string, unknown>) : undefined;
          return Boolean(metaObj?.priceTableOfficial);
        });

        for (const other of others) {
          await upsertMediaAsset({
            ...other,
            meta: {
              ...(other.meta && typeof other.meta === "object" ? (other.meta as Record<string, unknown>) : {}),
              priceTableOfficial: false,
            },
          });
        }
      }
    }

    return NextResponse.json({ media: saved }, { status: 200 });
  } catch (error: unknown) {
    console.error("Erro ao salvar media asset:", error);
    return NextResponse.json({ error: "Erro interno ao salvar media asset." }, { status: 500 });
  }
}

// DELETE /api/clients/:clientId/media-assets?id=media_xyz
export async function DELETE(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório na rota." }, { status: 400 });
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Parâmetro ?id é obrigatório para excluir." }, { status: 400 });
    }

    const list = await listMediaByClient(clientId);
    const asset = list.find((m) => m.id === id);

    if (!asset) {
      return NextResponse.json({ error: "Media asset não encontrado para este cliente." }, { status: 404 });
    }

    // Se for arquivo interno, tenta remover do disco.
    if (asset.url.startsWith("/uploads/media/")) {
      try {
        const relative = asset.url.replace(/^\/uploads\/media\//, "");
        const [assetClientId, ...rest] = relative.split("/");
        if (assetClientId === clientId && rest.length > 0) {
          const filePath = path.join(getClientDir(clientId), rest.join("/"));
          await fs.unlink(filePath).catch(() => {});
        }
      } catch (err) {
        console.warn("[MEDIA-ASSETS] Falha ao remover arquivo físico de mídia:", err);
      }
    }

    await deleteMediaAsset(id);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("Erro ao excluir media asset:", error);
    return NextResponse.json({ error: "Erro interno ao excluir media asset." }, { status: 500 });
  }
}
