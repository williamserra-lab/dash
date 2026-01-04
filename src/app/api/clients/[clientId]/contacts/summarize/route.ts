// src/app/api/clients/[clientId]/contacts/summarize/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { generateMockConversationSummariesByClient } from "@/lib/contacts";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function POST(
  _req: NextRequest,
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

    const contacts = await generateMockConversationSummariesByClient(clientId);
    return NextResponse.json(
      { contacts, message: "Resumos gerados (mock) com sucesso." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Erro ao gerar resumos de conversa:", error);
    return NextResponse.json(
      { error: "Erro interno ao gerar resumos de conversa." },
      { status: 500 }
    );
  }
}
