// src/app/api/clients/[clientId]/conversation-events/route.ts
// Conversation event log (DB or JSON fallback).
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { listConversationEvents } from "@/lib/conversationEvents";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;

  try {
    await assertClientActive(clientId);

    const url = new URL(req.url);
    const instance = String(url.searchParams.get("instance") || "").trim();
    const remoteJid = String(url.searchParams.get("remoteJid") || "").trim();
    if (!instance || !remoteJid) {
      return NextResponse.json({ error: "Parâmetros obrigatórios: instance, remoteJid" }, { status: 400 });
    }

    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

    const events = await listConversationEvents({ clientId, instance, remoteJid, limit });
    return NextResponse.json({ events });
  } catch (e: any) {
    if (e instanceof ClientAccessError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Erro ao listar conversation-events:", e);
    return NextResponse.json({ error: "Erro interno ao listar eventos." }, { status: 500 });
  }
}
