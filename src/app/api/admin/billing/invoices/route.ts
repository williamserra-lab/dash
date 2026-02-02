import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseLimit(v: string | null, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "open,overdue").trim();
  const limit = parseLimit(url.searchParams.get("limit"), 100);
  const statuses = status
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const where: string[] = [];
  const params: any[] = [];
  let p = 0;

  if (statuses.length && statuses[0] !== "all") {
    where.push(`status = ANY($${++p})`);
    params.push(statuses);
  }

  const sql = `
    SELECT id, client_id, plan_id, amount_cents, currency, due_date, status, paid_at, cycle_start, cycle_end, created_at
    FROM nextia_invoices
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY due_date DESC
    LIMIT ${limit}
  `;

  const res = await dbQuery(sql, params);
  return NextResponse.json({ items: res.rows || [] });
}
