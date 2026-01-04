// src/app/api/clients/[clientId]/lists/[listId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { deleteList, getListById, updateList } from "@/lib/contactLists";

type RouteContext = { params: Promise<{ clientId: string; listId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId, listId } = await context.params;
  try {
    const list = await getListById(clientId, listId);
    if (!list) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
    return NextResponse.json({ list });
  } catch (e) {
    console.error("Erro ao ler lista:", e);
    return NextResponse.json({ error: "Erro interno ao ler lista." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId, listId } = await context.params;
  try {
    const body = await req.json().catch(() => ({}));
    const patch: any = {};
    if (typeof (body as any).name === "string") patch.name = (body as any).name;
    if (Array.isArray((body as any).contactIds)) patch.contactIds = (body as any).contactIds;
    const updated = await updateList(clientId, listId, patch);
    if (!updated) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
    return NextResponse.json({ list: updated });
  } catch (e) {
    console.error("Erro ao atualizar lista:", e);
    return NextResponse.json({ error: "Erro interno ao atualizar lista." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId, listId } = await context.params;
  try {
    const ok = await deleteList(clientId, listId);
    if (!ok) return NextResponse.json({ error: "Lista não encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Erro ao deletar lista:", e);
    return NextResponse.json({ error: "Erro interno ao deletar lista." }, { status: 500 });
  }
}
