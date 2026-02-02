export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { bumpAdminSessionVersion } from "@/lib/adminCredentials";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const sv = await bumpAdminSessionVersion();
  return NextResponse.json({ ok: true, sessionVersion: sv }, { status: 200 });
}
