// src/app/api/admin/outbox/enqueue/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";

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

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
