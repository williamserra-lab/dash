// src/app/api/clients/[clientId]/preorders/[preorderId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { getPreorderById, updatePreorder } from "@/lib/preorders";

type RouteContext = { params: Promise<{ clientId: string; preorderId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, preorderId } = await context.params;
    if (!clientId || !preorderId) {
      return NextResponse.json({ error: "clientId e preorderId são obrigatórios." }, { status: 400 });
    }

    const preorder = await getPreorderById(clientId, preorderId);
    if (!preorder) {
      return NextResponse.json({ error: "Pré-pedido não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ preorder }, { status: 200 });
  } catch (error) {
    console.error("Erro ao ler pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao ler pré-pedido." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, preorderId } = await context.params;
    if (!clientId || !preorderId) {
      return NextResponse.json({ error: "clientId e preorderId são obrigatórios." }, { status: 400 });
    }

    const body = await readJsonObject(req);
    const updated = await updatePreorder(clientId, preorderId, {
      items: (body as any).items,
      delivery: (body as any).delivery,
      payment: (body as any).payment,
      status: (body as any).status,
      actor: (body as any).actor,
      note: typeof (body as any).note === "string" ? (body as any).note : null,
    });

    if (!updated) {
      return NextResponse.json({ error: "Pré-pedido não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ preorder: updated }, { status: 200 });
  } catch (error) {
    console.error("Erro ao atualizar pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar pré-pedido." }, { status: 500 });
  }
}
