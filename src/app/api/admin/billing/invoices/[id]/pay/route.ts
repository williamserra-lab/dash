import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { dbQuery } from "@/lib/db";
import { getBillingSummaryForClient } from "@/lib/billingCore";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = await ctx.params;

  const invRes = await dbQuery(
    `UPDATE nextia_invoices
     SET status='paid', paid_at=NOW(), updated_at=NOW()
     WHERE id=$1
     RETURNING id, client_id`,
    [id]
  );
  const inv = (invRes.rows?.[0] as any) || null;
  if (!inv) {
    return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  }

  const summary = await getBillingSummaryForClient(String(inv.client_id));
  return NextResponse.json({ ok: true, invoiceId: id, clientId: inv.client_id, summary });
}
