// src/app/api/clients/[clientId]/media-quota/route.ts
// Retorna a quota de armazenamento de mídia de um cliente.
//
// Regras (configuráveis via env):
// - Diretório base: public/uploads/media/<clientId>
// - Limite máximo por arquivo: MAX_MEDIA_FILE_MB (default 10 MB)
// - Limite máximo total por cliente: MAX_MEDIA_TOTAL_MB (default 100 MB)
// - usedBytes = soma do tamanho de todos os arquivos do cliente

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getDirectorySizeBytes,
  getMaxFileBytes,
  getMaxTotalBytes,
} from "@/lib/storageLimits";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

const UPLOAD_BASE_DIR = path.join(process.cwd(), "public", "uploads", "media");



export async function GET(
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

    const clientDir = path.join(UPLOAD_BASE_DIR, clientId);
    const usedBytes = await getDirectorySizeBytes(clientDir);

    return NextResponse.json(
      {
        usedBytes,
        maxBytes: getMaxTotalBytes(),
        maxFileBytes: getMaxFileBytes(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Erro ao obter quota de mídia:", error);
    return NextResponse.json(
      { error: "Erro interno ao obter quota de mídia." },
      { status: 500 }
    );
  }
}
