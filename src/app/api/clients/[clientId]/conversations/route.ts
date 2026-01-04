// src/app/api/clients/[clientId]/conversations/route.ts
// Conversation list for the "chat do lojista".
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { listConversations } from "@/lib/nextiaConversationIndex";
import { getConversationState, type ConversationKey } from "@/lib/nextiaConversationStateStore";

type RouteContext = { params: Promise<{ clientId: string }> };

function pickDeterministicPhase(state: any): string | null {
  if (!state || typeof state !== "object") return null;
  const phase = (state as any).phase;
  return typeof phase === "string" ? phase : null;
}

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { clientId } = await context.params;

  try {
    await assertClientActive(clientId);

    const url = new URL(req.url);
    const instance = String(url.searchParams.get("instance") || "").trim();
    if (!instance) {
      return NextResponse.json({ error: "Parâmetro obrigatório: instance" }, { status: 400 });
    }

    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));

    const list = await listConversations({ clientId, instance, limit });

    // Enrich with deterministic phase/handoff flag when available.
    const enriched = await Promise.all(
      list.map(async (it) => {
        const key: ConversationKey = { clientId, instance: it.instance, remoteJid: it.remoteJid };
        const st = await getConversationState(key).catch(() => null);
        const phase = pickDeterministicPhase(st);
        const handoffActive = !!(st && typeof st === "object" && (st as any).handoffActive);
        return { ...it, phase, handoffActive };
      })
    );

    return NextResponse.json({ conversations: enriched });
  } catch (e: any) {
    if (e instanceof ClientAccessError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    console.error("Erro ao listar conversas:", e);
    return NextResponse.json({ error: "Erro interno ao listar conversas." }, { status: 500 });
  }
}
