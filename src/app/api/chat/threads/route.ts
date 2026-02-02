// src/app/api/chat/threads/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createThread, listThreads } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;
const { searchParams } = new URL(req.url);
  const clientId = (searchParams.get("clientId") || "").trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const threads = await listThreads(clientId);
  const res = NextResponse.json({ threads }, { status: 200 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req));
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const title = typeof body.title === "string" ? body.title : undefined;
  const contactId = typeof body.contactId === "string" ? body.contactId : undefined;

  const thread = await createThread(clientId, title, contactId);
  const res = NextResponse.json({ thread }, { status: 201 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}
