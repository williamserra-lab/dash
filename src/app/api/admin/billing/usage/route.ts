export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { getUsageMonth, getMonthKey, getUsageContextMonth } from "@/lib/llmBudget";

const QuerySchema = z.object({
  clientId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM
});

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    clientId: url.searchParams.get("clientId") || "",
    month: url.searchParams.get("month") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_query", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const { clientId } = parsed.data;
  const monthKey = parsed.data.month ?? getMonthKey(new Date());

  const month = await getUsageMonth(clientId, monthKey);
  const ctx = await getUsageContextMonth(clientId, monthKey);

  return NextResponse.json({
    ok: true,
    clientId,
    monthKey,
    total: month,
    breakdown: ctx.byContext,
    contextTotals: ctx.totals,
    lastUpdatedAt: ctx.lastUpdatedAt,
  });
}
