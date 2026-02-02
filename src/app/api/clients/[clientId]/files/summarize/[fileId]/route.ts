// src/app/api/clients/[clientId]/files/summarize/[fileId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

/**
 * GET/POST /api/clients/:clientId/files/summarize/:fileId
 *
 * Rota reservada para futuro módulo de sumarização por tenant.
 * Atualmente o fluxo real está em /api/admin/files/summarize/:fileId (admin-only).
 */
export async function GET(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  return NextResponse.json(
    {
      error: "deprecated",
      message: "Rota reservada (tenant-scoped). Use /api/admin/files/summarize/:fileId (admin-only).",
    },
    { status: 410 }
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  return NextResponse.json(
    {
      error: "deprecated",
      message: "Rota reservada (tenant-scoped). Use /api/admin/files/summarize/:fileId (admin-only).",
    },
    { status: 410 }
  );
}
