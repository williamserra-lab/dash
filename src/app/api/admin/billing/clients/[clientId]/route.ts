import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { dbQuery } from "@/lib/db";
import { ensureBillingForClient, getBillingSummaryForClient } from "@/lib/billingCore";

export const dynamic = "force-dynamic";

function parseBody(v: any): any {
  return v && typeof v === "object" ? v : {};
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { clientId } = await ctx.params;
  await ensureBillingForClient(clientId);
  const summary = await getBillingSummaryForClient(clientId);
  return NextResponse.json(summary);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { clientId } = await ctx.params;
  const body = parseBody(await req.json().catch(() => ({})));

  const patch: string[] = [];
  const params: any[] = [];
  let p = 1;

  if (typeof body.planId === "string" && body.planId.trim()) {
    patch.push(`plan_id=$${++p}`);
    params.push(body.planId.trim());
  }

  if (typeof body.status === "string" && ["active", "grace", "suspended"].includes(body.status)) {
    patch.push(`billing_status=$${++p}`);
    params.push(body.status);
  }

  if (typeof body.graceDays === "number" && Number.isFinite(body.graceDays) && body.graceDays >= 0) {
    patch.push(`grace_days=$${++p}`);
    params.push(Math.floor(body.graceDays));
  }

  if (typeof body.graceUntil === "string") {
    patch.push(`grace_until=$${++p}`);
    params.push(body.graceUntil.trim() || null);
  }

  if (typeof body.suspendedReason === "string") {
    patch.push(`suspended_reason=$${++p}`);
    params.push(body.suspendedReason.trim() || null);
  }

  if (!patch.length) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  params.unshift(clientId);
  await dbQuery(
    `UPDATE nextia_client_billing SET ${patch.join(", ")}, updated_at=NOW() WHERE client_id=$1`,
    params
  );

  const summary = await getBillingSummaryForClient(clientId);
  return NextResponse.json({ ok: true, summary });
}
