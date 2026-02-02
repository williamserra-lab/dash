// src/app/api/chat/contacts/[contactId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { deleteContact } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * DELETE /api/chat/contacts/[contactId]?clientId=...
 * Production contract:
 * - Always returns a Response (never null/undefined), to satisfy Next.js route type validator.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ contactId: string }> }
) {
  // requireAdmin may be sync or async depending on auth implementation.
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  const { searchParams } = new URL(req.url);
  const clientId = (searchParams.get("clientId") || "").trim();
  if (!clientId) {
    return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  }

  const { contactId: raw } = await ctx.params;
  const contactId = decodeURIComponent(raw || "").trim();
  if (!contactId) {
    return NextResponse.json({ error: "contactId_required" }, { status: 400 });
  }

  const ok = await deleteContact(clientId, contactId);

  // Important: never return null. If not found, respond 404 with ok=false.
  const res = NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}
