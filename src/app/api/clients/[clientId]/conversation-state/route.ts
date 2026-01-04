// src/app/api/clients/[clientId]/conversation-state/route.ts
// Read deterministic conversation state (for ops/UI).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getConversationState, type ConversationKey } from "@/lib/nextiaConversationStateStore";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;

  try {
    await assertClientActive(clientId);

    const url = new URL(req.url);
    const instance = String(url.searchParams.get("instance") || "").trim();
    const remoteJid = String(url.searchParams.get("remoteJid") || "").trim();
    if (!instance || !remoteJid) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: instance, remoteJid" },
        { status: 400 }
      );
    }

    const key: ConversationKey = { clientId, instance, remoteJid };
    const state = await getConversationState(key);
    return NextResponse.json({ state: state ?? null });
  } catch (e: any) {
    if (e instanceof ClientAccessError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Erro ao ler conversation-state:", e);
    return NextResponse.json({ error: "Erro interno ao ler estado da conversa." }, { status: 500 });
  }
}
