// src/app/api/admin/outbox/run/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { runWhatsappOutbox } from "@/lib/whatsappOutboxRunner";
import { readJsonObject } from "@/lib/http/body";

const BodySchema = z.object({
  clientId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const body = await readJsonObject(req);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "Payload inválido.", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const result = await runWhatsappOutbox(parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
