// src/app/api/webhooks/whatsapp/inbound/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getClientById, getClientByWhatsappNumber } from "@/lib/clientsRegistry";
import { handleWhatsappInboundFlow } from "@/lib/whatsappInboundFlow";

const InboundSchema = z
  .object({
    clientId: z.string().optional(),
    to: z.string().default(""),
    from: z.string().min(1),
    body: z.string().default(""),
    media: z
      .array(
        z.object({
          url: z.string().url(),
          contentType: z.string().optional(),
          fileName: z.string().optional(),
          size: z.number().optional(),
        })
      )
      .default([]),
    source: z.string().optional(),
    raw: z.any().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.clientId && !val.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either clientId or to is required",
        path: ["to"],
      });
    }
  });

export async function POST(req: NextRequest) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = InboundSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
    }

    const client =
      parsed.data.clientId
        ? await getClientById(parsed.data.clientId)
        : await getClientByWhatsappNumber(parsed.data.to);

    if (!client) {
      return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    }

    const clientId = client.id;

    const result = await handleWhatsappInboundFlow({
      client,
      clientId,
      to: parsed.data.to || "",
      from: parsed.data.from,
      body: parsed.data.body || "",
      source: parsed.data.source || null,
      raw: parsed.data.raw,
      instance: null,
    });

    if (result.mode === "deterministic") {
      return NextResponse.json({ ok: true, mode: "deterministic" }, { status: 200 });
    }

    return NextResponse.json(
      { ok: true, reply: result.reply, contactId: result.contactId, degraded: result.degraded },
      { status: 200 }
    );
  } catch (err: unknown) {
    console.error("[WHATSAPP INBOUND] erro:", err);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
