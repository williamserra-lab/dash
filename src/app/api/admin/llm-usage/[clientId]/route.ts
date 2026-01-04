import { NextRequest, NextResponse } from "next/server";
import { getBudgetSnapshot, getUsageMonth } from "@/lib/llmBudget";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const id = String(clientId || "").trim();
  if (!id) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const snap = await getBudgetSnapshot(id);
  const usage = await getUsageMonth(id, snap.monthKey);

  return NextResponse.json({ ok: true, snapshot: snap, usage }, { status: 200 });
}
