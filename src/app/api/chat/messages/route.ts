// src/app/api/chat/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listMessages } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const clientId = (searchParams.get("clientId") || "").trim();
  const threadId = (searchParams.get("threadId") || "").trim();

  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  if (!threadId) return NextResponse.json({ error: "threadId_required" }, { status: 400 });

  const messages = await listMessages(clientId, threadId);
  const res = NextResponse.json({ messages }, { status: 200 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}
