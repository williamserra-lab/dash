export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { getMonthKey, resetUsageMonth, resetUsageContextMonth } from "@/lib/llmBudget";

const BodySchema = z.object({
  clientId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM
  resetContext: z.boolean().optional().default(true),
});

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const raw = await req.text();
  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const clientId = parsed.data.clientId;
  const monthKey = parsed.data.month ?? getMonthKey(new Date());

  await resetUsageMonth(clientId, monthKey);
  if (parsed.data.resetContext) {
    await resetUsageContextMonth(clientId, monthKey);
  }

  return NextResponse.json({ ok: true, clientId, monthKey }, { status: 200 });
}
