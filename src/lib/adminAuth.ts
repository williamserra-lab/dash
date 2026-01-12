// src/lib/adminAuth.ts
// Centralized admin authorization for routes (API) and middleware.
// Accepts either:
//  - Cookie session (nextia_admin_session) set by /api/admin/auth/login
//  - Header x-nextia-admin-key matching NEXTIA_ADMIN_KEY (useful for scripts)
//
// In dev, if NEXTIA_ADMIN_KEY is missing, admin is allowed.
// In production, missing key means "no admin access".

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE_NAME = "nextia_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

function isDevModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function verifySessionCookie(secret: string, cookieValue: string): boolean {
  // cookie format: "<ts>.<sig>" where sig = HMAC_SHA256(secret, ts)
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return false;

  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds < 0 || ageSeconds > SESSION_TTL_SECONDS) return false;

  const expectedSig = createHmac("sha256", secret).update(tsStr).digest("hex");
  try {
    const a = Buffer.from(expectedSig, "hex");
    const b = Buffer.from(sig, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function isAdminAuthorized(req: NextRequest): boolean {
  const expected = getExpectedAdminKey();

  // Dev mode: allow if key not configured.
  if (!expected) return isDevModeAllowed();

  // 1) Cookie session
  const session = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (session && verifySessionCookie(expected, session)) return true;

  // 2) Header key (scripts)
  const got = (req.headers.get("x-nextia-admin-key") || "").trim();
  return got === expected;
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  if (isAdminAuthorized(req)) return null;

  return NextResponse.json(
    {
      error: "admin_unauthorized",
      message:
        "Acesso negado. Faça login em /admin-login ou envie o header x-nextia-admin-key com NEXTIA_ADMIN_KEY.",
    },
    { status: 401 }
  );
}
