// src/app/api/clients/[clientId]/contacts/[contactId]/tags/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { setContactTags } from "@/lib/contacts";

type RouteContext = { params: Promise<{ clientId: string; contactId: string }> };

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId, contactId } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const tags = Array.isArray((body as any).tags) ? (body as any).tags : [];
    const updated = await setContactTags(clientId, contactId, tags);
    if (!updated) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ contact: updated });
  } catch (e) {
    console.error("Erro ao atualizar tags do contato:", e);
    return NextResponse.json({ error: "Erro interno ao atualizar tags." }, { status: 500 });
  }
}
