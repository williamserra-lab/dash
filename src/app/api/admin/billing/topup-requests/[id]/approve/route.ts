import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, getAdminActor } from "@/lib/adminAuth";
import { ensureDbSchema, dbQuery } from "@/lib/db";
import { createTopupGrant } from "@/lib/topupGrants";
import { getMonthKey } from "@/lib/llmBudget";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

// Next.js (v15+) types `params` as a Promise in route handlers.
// Using `await` here keeps compatibility even if runtime provides a plain object.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const deny = await requireSuperAdmin(req);
  if (deny) return deny;

  await ensureDbSchema();

  const { id } = await ctx.params;
  const requestId = (id || "").trim();
  if (!requestId) return NextResponse.json({ ok: false, error: "missing_id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const creditsGranted = Math.trunc(Number(body?.creditsGranted || body?.credits || 0));
  if (!Number.isFinite(creditsGranted) || creditsGranted <= 0) {
    return NextResponse.json({ ok: false, error: "bad_credits", message: "creditsGranted deve ser > 0" }, { status: 400 });
  }

  const amountCentsRaw = body?.amountCents ?? body?.amountPaidCents ?? body?.amount_paid_cents;
  const amountCents = amountCentsRaw === undefined || amountCentsRaw === null || amountCentsRaw === ""
    ? null
    : Math.trunc(Number(amountCentsRaw));
  const currency = String(body?.currency || "BRL").trim() || "BRL";
  const notes = body?.notes ? String(body?.notes).slice(0, 4000) : null;
  const expiresAt = body?.expiresAt ? String(body?.expiresAt) : null;

  // Load request
  const reqRes = await dbQuery<any>("SELECT * FROM nextia_credit_topup_requests WHERE id=$1 LIMIT 1", [requestId]);
  const row = reqRes.rows?.[0];
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (row.status !== "pending") {
    return NextResponse.json({ ok: false, error: "not_pending", message: "Solicitação não está pendente." }, { status: 409 });
  }

  const clientId = String(row.client_id);
  const actor = (await getAdminActor(req)) || "superadmin";
  const monthKey = getMonthKey();

  // 1) Create grant row
  const grant = await createTopupGrant({
    clientId,
    monthKey,
    requestId,
    creditsGranted,
    amountCents,
    currency,
    notes,
    expiresAt,
    createdBy: actor,
    meta: { source: "admin_approve", requestId },
  });

  // 2) Also write to credit ledger for audit (best-effort)
  try {
    await dbQuery(
      "INSERT INTO nextia_credit_ledger (id, client_id, kind, amount, currency, ref_type, ref_id, meta) VALUES ($1,$2,'topup_grant',$3,'CREDITS',$4,$5,$6)",
      [randomUUID(), clientId, creditsGranted, "topup_request", requestId, JSON.stringify({ amountCents, currency, notes, monthKey, grantId: grant.id })]
    );
  } catch {
    // ignore
  }

  // 3) Approve request
  await dbQuery(
    "UPDATE nextia_credit_topup_requests SET status='approved', resolved_at=NOW(), resolved_by=$2, resolution_note=$3 WHERE id=$1",
    [requestId, actor, notes]
  );

  return NextResponse.json({ ok: true, requestId, clientId, grantId: grant.id, monthKey });
}
