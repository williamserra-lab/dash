// src/app/api/clients/[clientId]/preorders/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import {
  createPreorder,
  getPreordersByClient,
  type PreorderStatus,
} from "@/lib/preorders";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    const url = new URL(req.url);
    const statusRaw = (url.searchParams.get("status") || "").trim();
    const status: PreorderStatus | null =
      statusRaw === "draft" ||
      statusRaw === "awaiting_human_confirmation" ||
      statusRaw === "confirmed" ||
      statusRaw === "cancelled"
        ? (statusRaw as PreorderStatus)
        : null;

    const contactId = (url.searchParams.get("contactId") || "").trim() || null;
    const identifier = (url.searchParams.get("identifier") || "").trim() || null;
    const limitRaw = (url.searchParams.get("limit") || "").trim();
    const limit = limitRaw ? Number(limitRaw) : null;

    const preorders = await getPreordersByClient(clientId, { status, contactId, identifier, limit });
    return NextResponse.json({ preorders }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar pré-pedidos:", error);
    return NextResponse.json({ error: "Erro interno ao listar pré-pedidos." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });
    }

    const body = await readJsonObject(req);

    const contactId = String(body.contactId || "").trim();
    const identifier = String(body.identifier || "").trim();
    const contactName = typeof body.contactName === "string" ? body.contactName : null;

    if (!contactId || !identifier) {
      return NextResponse.json(
        { error: "contactId e identifier são obrigatórios para criar pré-pedido." },
        { status: 400 }
      );
    }

    const preorder = await createPreorder({
      clientId,
      contactId,
      identifier,
      contactName,
      items: (body as any).items,
      delivery: (body as any).delivery,
      payment: (body as any).payment,
      instance: typeof (body as any).instance === "string" ? (body as any).instance : null,
      remoteJid: typeof (body as any).remoteJid === "string" ? (body as any).remoteJid : null,
      actor: (body as any).actor,
    });

    return NextResponse.json({ preorder }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao criar pré-pedido." }, { status: 500 });
  }
}
