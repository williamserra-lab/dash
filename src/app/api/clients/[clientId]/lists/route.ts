// src/app/api/clients/[clientId]/lists/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createList, getListsByClient } from "@/lib/contactLists";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;
  try {
    const lists = await getListsByClient(clientId);
    return NextResponse.json({ lists });
  } catch (e) {
    console.error("Erro ao listar listas:", e);
    return NextResponse.json({ error: "Erro interno ao listar listas." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const name = String((body as any).name || "").trim();
    const contactIds = Array.isArray((body as any).contactIds) ? (body as any).contactIds : undefined;
    if (!name) {
      return NextResponse.json({ error: "Nome da lista é obrigatório." }, { status: 400 });
    }
    const list = await createList(clientId, { name, contactIds });
    return NextResponse.json({ list }, { status: 201 });
  } catch (e) {
    console.error("Erro ao criar lista:", e);
    return NextResponse.json({ error: "Erro interno ao criar lista." }, { status: 500 });
  }
}
