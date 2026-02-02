// src/app/api/admin/outbox/enqueue/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";
import { appendConversationEvent, makeEventId } from "@/lib/conversationEvents";
import { getConversationState, setConversationState } from "@/lib/nextiaConversationStateStore";

const EnqueueSchema = z.object({
  clientId: z.string().min(1),
  to: z.string().min(1),
  message: z.string().min(1),
  messageType: z.string().optional().nullable(),
  orderId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const json = await req.json().catch(() => ({}));
    const parsed = EnqueueSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const item = await enqueueWhatsappText(parsed.data);

    // Instrumentação: marca envio humano (enfileirado) para métricas por atendente.
    try {
      const ctx: any = parsed.data.context || {};
      const kind = typeof ctx.kind === "string" ? ctx.kind : "";
      const inst = typeof ctx.instance === "string" && ctx.instance.trim() ? ctx.instance.trim() : "NextIA";
      const remoteJid = parsed.data.to;
      const attendantId = typeof ctx.attendantId === "string" ? ctx.attendantId : null;

      if (kind === "lojista_reply") {
        await appendConversationEvent({
          id: makeEventId({ clientId: parsed.data.clientId, instance: inst, remoteJid, eventType: "human_message_sent", dedupeKey: null }),
          createdAt: new Date().toISOString(),
          clientId: parsed.data.clientId,
          instance: inst,
          remoteJid,
          eventType: "human_message_sent",
          payload: { attendantId, source: "painel_chat" },
          meta: { messageType: parsed.data.messageType || null },
        });

        // Handoff: se a conversa está em handoff, persistir quem assumiu (attendantId) para auditoria/retomada.
        // Isso evita que o bot volte a responder enquanto humano está atendendo.
        if (attendantId) {
          try {
            const key = { clientId: parsed.data.clientId, instance: inst, remoteJid };
            const prev = await getConversationState(key);
            const prevPhase = prev && typeof (prev as any).phase === "string" ? String((prev as any).phase) : "";
            const prevActive = Boolean(prev && ((prev as any).handoffActive === true || prevPhase === "handoff"));
            if (prevActive) {
              const hadAssignee = Boolean(prev && typeof (prev as any).handoffAttendantId === "string" && String((prev as any).handoffAttendantId).trim());
              const next = {
                ...(prev || {}),
                phase: "handoff",
                handoffActive: true,
                handoffAttendantId: attendantId,
                handoffAcceptedAt: (prev as any)?.handoffAcceptedAt || new Date().toISOString(),
              };
              await setConversationState(key, next as any);

              if (!hadAssignee) {
                await appendConversationEvent({
                  id: makeEventId({ clientId: parsed.data.clientId, instance: inst, remoteJid, eventType: "handoff_accepted", dedupeKey: attendantId }),
                  createdAt: new Date().toISOString(),
                  clientId: parsed.data.clientId,
                  instance: inst,
                  remoteJid,
                  eventType: "handoff_accepted",
                  payload: { attendantId, source: "painel_chat" },
                  meta: {},
                });
              }
            }
          } catch {
            // best-effort
          }
        }
      }
    } catch {
      // best-effort
    }

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
