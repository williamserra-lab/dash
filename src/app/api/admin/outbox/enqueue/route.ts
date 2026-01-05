// src/app/api/admin/outbox/enqueue/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";
import { appendConversationEvent, makeEventId } from "@/lib/conversationEvents";

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
