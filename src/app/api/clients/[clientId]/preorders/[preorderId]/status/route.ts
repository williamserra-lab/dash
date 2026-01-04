// src/app/api/clients/[clientId]/preorders/[preorderId]/status/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { setPreorderStatus, type PreorderStatus } from "@/lib/preorders";

type RouteContext = { params: Promise<{ clientId: string; preorderId: string }> };

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, preorderId } = await context.params;
    if (!clientId || !preorderId) {
      return NextResponse.json({ error: "clientId e preorderId são obrigatórios." }, { status: 400 });
    }

    const body = await readJsonObject(req);
    const statusRaw = String((body as any).status || "").trim();

    const status: PreorderStatus | null =
      statusRaw === "draft" ||
      statusRaw === "awaiting_human_confirmation" ||
      statusRaw === "confirmed" ||
      statusRaw === "cancelled"
        ? (statusRaw as PreorderStatus)
        : null;

    if (!status) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }

    const actor = (body as any).actor;
    const note = typeof (body as any).note === "string" ? (body as any).note : null;

    const updated = await setPreorderStatus(clientId, preorderId, status, actor, note);
    if (!updated) {
      return NextResponse.json({ error: "Pré-pedido não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ preorder: updated }, { status: 200 });
  } catch (error) {
    console.error("Erro ao atualizar status do pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar status." }, { status: 500 });
  }
}
