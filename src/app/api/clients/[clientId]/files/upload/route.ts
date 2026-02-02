// src/app/api/clients/[clientId]/files/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

/**
 * POST /api/clients/:clientId/files/upload
 *
 * Rota reservada para futuro módulo de arquivos por tenant.
 * Atualmente o fluxo real está em /api/admin/files/upload (admin-only).
 */
export async function POST(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  return NextResponse.json(
    {
      error: "deprecated",
      message: "Rota reservada (tenant-scoped). Use /api/admin/files/upload (admin-only).",
    },
    { status: 410 }
  );
}
