export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, getAdminSessionCookieOptions } from "@/lib/adminAuth";

// Admin logout: clears the session cookie.
// IMPORTANT: must return a Response in all cases (Next.js App Router requirement).
export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true }, { status: 200 });

  const opts = getAdminSessionCookieOptions(req);
  res.cookies.set(ADMIN_COOKIE_NAME, "", {
    ...opts,
    maxAge: 0,
  });

  return res;
}
