// src/app/api/chat/contacts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listContacts, upsertContact } from "@/lib/chatV1/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const clientId = (searchParams.get("clientId") || "").trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

  const contacts = await listContacts(clientId);
  const res = NextResponse.json({ contacts }, { status: 200 });
  res.headers.set("x-nextia-deprecated", "1");
  return res;
}

export async function POST(req: NextRequest) {
  const denied = await Promise.resolve(requireAdmin(req) as any);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return NextResponse.json({ error: "clientId_required" }, { status: 400 });

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

    const res = NextResponse.json({ contact }, { status: 201 });
    res.headers.set("x-nextia-deprecated", "1");
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: "invalid_contact", message: e?.message || "Contato inválido." }, { status: 400 });
  }
}
