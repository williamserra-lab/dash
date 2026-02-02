// src/app/api/clients/[clientId]/chat/contacts/[contactId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { deleteContact } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * DELETE /api/clients/:clientId/chat/contacts/:contactId
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string; contactId: string }> }
): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied as Response;

  const { clientId: rawClientId, contactId: rawContactId } = await ctx.params;
  const clientId = decodeURIComponent(String(rawClientId || "")).trim();
  const contactId = decodeURIComponent(String(rawContactId || "")).trim();

  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });
  if (!contactId) return NextResponse.json({ error: "contactId_required" }, { status: 400 });

  const ok = await deleteContact(clientId, contactId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
