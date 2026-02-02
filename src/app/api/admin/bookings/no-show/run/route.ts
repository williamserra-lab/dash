// src/app/api/admin/bookings/no-show/run/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { readJsonObject } from "@/lib/http/body";
import { runBookingNoShowCycle } from "@/lib/bookings";

const BodySchema = z.object({
  clientId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  dryRun: z.boolean().optional(),
  graceMinutes: z.number().int().min(0).max(240).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const body = await readJsonObject(req);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Payload inválido.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { clientId, limit, dryRun, graceMinutes } = parsed.data;
    const result = await runBookingNoShowCycle({ clientId, limit, dryRun, graceMinutes });
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
