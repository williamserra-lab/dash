// src/app/api/admin/chat/messages/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listStoredMessages } from "@/lib/nextiaMessageStore";

const QuerySchema = z.object({
  clientId: z.string().min(1),
  instance: z.string().min(1),
  remoteJid: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Query inválida.", details: parsed.error.format() }, { status: 400 });
    }

    const items = await listStoredMessages(parsed.data);
    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Erro interno.", details: String(err?.message || err) },
      { status: 500 }
    );
  }
}
