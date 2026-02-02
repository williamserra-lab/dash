import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseBody(v: any): any {
  return v && typeof v === "object" ? v : {};
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const res = await dbQuery(`SELECT * FROM nextia_plans ORDER BY created_at DESC, id ASC`);
  return NextResponse.json({ plans: res.rows || [] });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = parseBody(await req.json().catch(() => ({})));
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  if (!id || !name) {
    return NextResponse.json({ error: "invalid_input", message: "id e name são obrigatórios" }, { status: 400 });
  }
  const status = String(body.status || "active").trim() || "active";
  const priceCents = Number(body.priceCents ?? body.price_cents ?? 0);
  const currency = String(body.currency || "BRL").trim() || "BRL";
  const entitlements = body.entitlements && typeof body.entitlements === "object" ? body.entitlements : {};
  const paymentInstructions = body.paymentInstructions && typeof body.paymentInstructions === "object" ? body.paymentInstructions : null;

  await dbQuery(
    `INSERT INTO nextia_plans (id, name, status, price_cents, currency, entitlements, payment_instructions)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name,
       status=EXCLUDED.status,
       price_cents=EXCLUDED.price_cents,
       currency=EXCLUDED.currency,
       entitlements=EXCLUDED.entitlements,
       payment_instructions=EXCLUDED.payment_instructions,
       updated_at=NOW()`,
    [
      id,
      name,
      status,
      Number.isFinite(priceCents) ? Math.floor(priceCents) : 0,
      currency,
      JSON.stringify(entitlements),
      JSON.stringify(paymentInstructions),
    ]
  );

  return NextResponse.json({ ok: true });
}
