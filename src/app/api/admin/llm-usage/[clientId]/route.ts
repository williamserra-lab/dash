export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addUsage, getBudgetSnapshot, getUsageContextMonth, getUsageMonth, getMonthKey } from "@/lib/llmBudget";
import { resetUsageMonthForClient } from "@/lib/llmBudgetReset";

const BodySchema = z
  .object({
    // When true, resets usage for the given monthKey (or current month if omitted)
    resetMonth: z.boolean().optional(),
    // Optional usage delta to add after reset (or standalone)
    add: z
      .object({
        promptTokens: z.number().int().nonnegative().optional(),
        completionTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        monthKey: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .optional(),
    // For accounting breakdown only (does not affect policy thresholds)
    context: z
      .enum(["inbound", "campaign", "admin_llm_test", "unknown"])
      .optional(),
  })
  .partial();

async function readJsonSafe(req: NextRequest): Promise<unknown> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const id = String(clientId || "").trim();
  if (!id) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const snap = await getBudgetSnapshot(id);
  const usage = await getUsageMonth(id, snap.monthKey);

  return NextResponse.json({ ok: true, snapshot: snap, usage }, { status: 200 });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  const id = String(clientId || "").trim();
  if (!id) return NextResponse.json({ error: "clientId é obrigatório" }, { status: 400 });

  const parsed = BodySchema.safeParse(await readJsonSafe(req));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "body inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const monthKey = body.add?.monthKey || getMonthKey();
  const context = body.context || "admin_llm_test";

  if (body.resetMonth) {
    await resetUsageMonthForClient({ clientId: id, monthKey });
  }

  if (body.add) {
    await addUsage(
      id,
      {
        ...body.add,
        monthKey,
        provider: body.add.provider ?? "sim",
        model: body.add.model ?? "sim",
      },
      { context: context as any, actorType: "admin", actorId: "admin_budget_test_ui" }
    );
  }

  const snap = await getBudgetSnapshot(id);
  const usage = await getUsageMonth(id, snap.monthKey);
  const ctxMonth = await getUsageContextMonth(id, snap.monthKey);

  return NextResponse.json(
    {
      ok: true,
      snapshot: snap,
      usage,
      contextTotals: ctxMonth.totals,
      breakdown: ctxMonth.byContext,
    },
    { status: 200 }
  );
}
