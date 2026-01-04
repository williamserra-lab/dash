// src/app/api/clients/[clientId]/tags/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getTagsByClient } from "@/lib/contacts";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;
  try {
    const tags = await getTagsByClient(clientId);
    return NextResponse.json({ tags });
  } catch (e) {
    console.error("Erro ao listar tags:", e);
    return NextResponse.json({ error: "Erro interno ao listar tags." }, { status: 500 });
  }
}
