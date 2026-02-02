export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getClientById, updateClient, type ClientRecord } from "@/lib/clients";

type Ctx = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const denied = await requireAdmin(_req);
    if (denied) return denied;

    const { clientId } = await ctx.params;
    const client = await getClientById(clientId);
    if (!client) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }
    return NextResponse.json({ client }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const { clientId } = await ctx.params;
    const body = (await req.json()) as Partial<ClientRecord> | null;

    const patch: Partial<ClientRecord> = {};

    if (body && typeof body === "object") {
      if (typeof body.name === "string") patch.name = body.name;
      // mantém compatibilidade: aceita segment/status se existirem no tipo atual
      if ("segment" in body) (patch as any).segment = (body as any).segment;
      if ("status" in body) (patch as any).status = (body as any).status;

      // profile administrativo (JSONB), se existir na versão do seu ClientRecord
      if ("profile" in body) (patch as any).profile = (body as any).profile;

      // whatsappNumbers canônico
      if ("whatsappNumbers" in body) {
        (patch as any).whatsappNumbers = (body as any).whatsappNumbers;
      }
    }

    const updated = await updateClient(clientId, patch);

    if (!updated) {
      return NextResponse.json({ error: "client not found" }, { status: 404 });
    }

    return NextResponse.json({ client: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 400 }
    );
  }
}
