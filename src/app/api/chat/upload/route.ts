// src/app/api/chat/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { saveUploadedFile } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_form" }, { status: 400 });

  const clientId = String(form.get("clientId") || "").trim();
  const threadId = String(form.get("threadId") || "").trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  if (!threadId) return NextResponse.json({ error: "threadId_required" }, { status: 400 });

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

  const res = NextResponse.json({ attachment }, { status: 201 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}
