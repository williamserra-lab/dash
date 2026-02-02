// src/app/api/clients/[clientId]/chat/threads/[threadId]/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getThread, saveUploadedFile } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * POST /api/clients/:clientId/chat/threads/:threadId/upload
 * FormData: file
 */
export async function POST(
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

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file_required" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const attachment = await saveUploadedFile({
    clientId,
    threadId,
    filename: file.name || "arquivo",
    mimeType: file.type || "application/octet-stream",
    buffer: buf,
  });

  return NextResponse.json({ attachment }, { status: 201 });
}
