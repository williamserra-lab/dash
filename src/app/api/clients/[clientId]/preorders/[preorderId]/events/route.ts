// src/app/api/clients/[clientId]/preorders/[preorderId]/events/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { listPreorderEvents } from "@/lib/preorders";

type RouteContext = { params: Promise<{ clientId: string; preorderId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, preorderId } = await context.params;
    if (!clientId || !preorderId) {
      return NextResponse.json({ error: "clientId e preorderId são obrigatórios." }, { status: 400 });
    }

    const events = await listPreorderEvents(clientId, preorderId);
    return NextResponse.json({ events }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar eventos do pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao listar eventos." }, { status: 500 });
  }
}
