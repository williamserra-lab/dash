// src/app/api/clients/[clientId]/chat/threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createThread, listThreads } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * Canonical tenant-scoped endpoints for Chat V1.
 *
 * GET  /api/clients/:clientId/chat/threads
 * POST /api/clients/:clientId/chat/threads
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  // NOTE: kept as admin-only for now to preserve existing security model.
  const denied = await Promise.resolve(requireAdmin(_req));
  if (denied) return denied;

  const { clientId: raw } = await ctx.params;
  const clientId = decodeURIComponent(String(raw || "")).trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const threads = await listThreads(clientId);
  return NextResponse.json({ threads }, { status: 200 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const { clientId: raw } = await ctx.params;
  const clientId = decodeURIComponent(String(raw || "")).trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : undefined;
  const contactId = typeof body.contactId === "string" ? body.contactId : undefined;

  const thread = await createThread(clientId, title, contactId);
  return NextResponse.json({ thread }, { status: 201 });
}
