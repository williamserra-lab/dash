// src/app/api/clients/[clientId]/media-upload/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import {
  ensureDir,
  enforceStorageLimits,
  StorageLimitError,
} from "@/lib/storageLimits";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

const UPLOAD_BASE_DIR = path.join(process.cwd(), "public", "uploads", "media");

function getClientDir(clientId: string) {
  return path.join(UPLOAD_BASE_DIR, clientId);
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

async function getClientUsedBytes(clientId: string): Promise<number> {
  const dir = getClientDir(clientId);

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let total = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const stat = await fs.stat(full);
      total += stat.size;
    }

    return total;
  } catch (err: unknown) {
    // Se a pasta não existir ainda, uso é 0
    if (isErrnoException(err) && err.code === "ENOENT") return 0;
    throw err;
  }
}

function buildPublicUrl(clientId: string, fileName: string) {
  // Caminho acessível via HTTP (Next serve static de public/)
  return `/uploads/media/${encodeURIComponent(clientId)}/${encodeURIComponent(
    fileName
  )}`;
}

export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório na rota." },
        { status: 400 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado. Campo esperado: 'file'." },
        { status: 400 }
      );
    }

    const fileSize = file.size;
    // Limites universais: 10MB/arquivo, 100MB/escopo (por cliente aqui).
    const clientDir = getClientDir(clientId);
    const quota = await enforceStorageLimits({
      scope: "client",
      scopeLabel: clientId,
      scopeDir: clientDir,
      incomingBytes: fileSize,
    });

    await ensureDir(clientDir);

    const originalName = file.name || "arquivo";
    const ext = path.extname(originalName) || "";
    const base = path.basename(originalName, ext);
    const safeBase = base.replace(/[^\w\-]+/g, "_").slice(0, 80) || "file";

    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const finalName = `${safeBase}_${timestamp}_${random}${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const finalPath = path.join(clientDir, finalName);

    await fs.writeFile(finalPath, buffer);

    const usedAfter = quota.usedAfter;
    const publicUrl = buildPublicUrl(clientId, finalName);

    return NextResponse.json(
      {
        url: publicUrl,
        quota: {
          usedBytes: usedAfter,
          limitBytes: quota.maxTotalBytes,
          maxFileBytes: quota.maxFileBytes,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    if (error instanceof StorageLimitError) {
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 413 }
      );
    }
    console.error("[MEDIA-UPLOAD] Erro ao fazer upload:", error);
    return NextResponse.json(
      { error: "Erro interno ao fazer upload de arquivo." },
      { status: 500 }
    );
  }
}
