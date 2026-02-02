// src/app/api/clients/[clientId]/chat/threads/[threadId]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getThread, listMessages } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * GET /api/clients/:clientId/chat/threads/:threadId/messages
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string; threadId: string }> }
): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const { clientId: rawClientId, threadId: rawThreadId } = await ctx.params;
  const clientId = decodeURIComponent(String(rawClientId || "")).trim();
  const threadId = decodeURIComponent(String(rawThreadId || "")).trim();

  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  if (!threadId) return NextResponse.json({ error: "threadId_required" }, { status: 400 });

  // Strong tenant isolation: threadId must belong to clientId
  const thread = await getThread(clientId, threadId);
  if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const messages = await listMessages(clientId, threadId);
  return NextResponse.json({ messages }, { status: 200 });
}
