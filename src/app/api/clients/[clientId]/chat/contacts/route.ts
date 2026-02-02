// src/app/api/clients/[clientId]/chat/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listContacts, upsertContact } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

/**
 * GET  /api/clients/:clientId/chat/contacts
 * POST /api/clients/:clientId/chat/contacts
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(_req) as any);
  if (denied) return denied;

  const { clientId: raw } = await ctx.params;
  const clientId = decodeURIComponent(String(raw || "")).trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const contacts = await listContacts(clientId);
  return NextResponse.json({ contacts }, { status: 200 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }): Promise<Response> {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied;

  const { clientId: raw } = await ctx.params;
  const clientId = decodeURIComponent(String(raw || "")).trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });

  try {
    const contact = await upsertContact(clientId, {
      id: typeof body.id === "string" ? body.id : undefined,
      name,
      whatsapp: typeof body.whatsapp === "string" ? body.whatsapp : undefined,
      email: typeof body.email === "string" ? body.email : undefined,
      active: body.active === false ? false : true,
    });

    return NextResponse.json({ contact }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: "invalid_contact", message: e?.message || "Contato inválido." }, { status: 400 });
  }
}
