// src/app/api/clients/[clientId]/files/list/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

/**
 * GET /api/clients/:clientId/files/list
 *
 * Nota: neste momento o módulo /api/files foi descontinuado e o fluxo real
 * de arquivos está em /api/admin/files/* (admin-only).
 *
 * Esta rota existe apenas para reservar o contrato tenant-scoped.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  return NextResponse.json(
    {
      error: "deprecated",
      message: "Rota reservada (tenant-scoped). Use /api/admin/files/list (admin-only).",
    },
    { status: 410 }
  );
}
