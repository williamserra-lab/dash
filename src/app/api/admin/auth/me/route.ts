export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/adminAuth";

export async function GET(req: NextRequest) {
  const ok = isAdminAuthorized(req);
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}
