// src/app/api/clients/[clientId]/contacts/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getContactsByClient } from "@/lib/contacts";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const contacts = await getContactsByClient(clientId);
    return NextResponse.json({ contacts }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar contatos:", error);
    return NextResponse.json(
      { error: "Erro interno ao listar contatos." },
      { status: 500 }
    );
  }
}
