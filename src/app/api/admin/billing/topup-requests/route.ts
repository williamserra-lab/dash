import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { listTopupRequests } from "@/lib/topupRequests";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").trim() as any;
  const limit = Number(url.searchParams.get("limit") || "50");

  const rows = await listTopupRequests({ status, limit });
  return NextResponse.json({ ok: true, items: rows });
}
