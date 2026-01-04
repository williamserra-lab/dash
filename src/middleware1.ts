import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "nextia_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

function isDevModeAllowed(): boolean {
  // In dev, allow running without configuring the key.
  // In production, missing key means "no admin access".
  return process.env.NODE_ENV !== "production";
}

function headerAdminKeyMatches(req: NextRequest, expected: string): boolean {
  const got = (req.headers.get("x-nextia-admin-key") || "").trim();
  return Boolean(expected) && got === expected;
}

function parseSessionCookie(req: NextRequest): { ts: number; sig: string } | null {
  const raw = req.cookies.get(COOKIE_NAME)?.value || "";
  const [tsStr, sig] = raw.split(".", 2);
  const ts = Number(tsStr);
  if (!tsStr || !sig || !Number.isFinite(ts)) return null;
  return { ts, sig };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function cookieAdminAuthorized(req: NextRequest, expected: string): Promise<boolean> {
  if (!expected) return false;

  const parsed = parseSessionCookie(req);
  if (!parsed) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const tsSec = Math.floor(parsed.ts / 1000);

  if (tsSec > nowSec + 60) return false; // clock skew protection
  if (nowSec - tsSec > SESSION_TTL_SECONDS) return false;

  const expectedSig = await hmacSha256Hex(expected, String(parsed.ts));
  return parsed.sig.toLowerCase() === expectedSig.toLowerCase();
}

async function isAdminAuthorized(req: NextRequest): Promise<boolean> {
  const expected = getExpectedAdminKey();

  if (!expected) {
    return isDevModeAllowed();
  }

  if (headerAdminKeyMatches(req, expected)) return true;
  if (await cookieAdminAuthorized(req, expected)) return true;

  return false;
}

function isBypassPath(pathname: string): boolean {
  // These endpoints implement their own auth and must not be blocked by middleware.
  return pathname === "/api/admin/auth/login" || pathname === "/api/admin/auth/logout";
}

export async function middleware(req: NextRequest) {
  // Allow CORS preflight without auth.
  if (req.method === "OPTIONS") return NextResponse.next();

  const pathname = req.nextUrl.pathname || "";

  if (isBypassPath(pathname)) return NextResponse.next();

  const ok = await isAdminAuthorized(req);
  if (ok) return NextResponse.next();

  // If it's a page, redirect to admin login.
  if (pathname.startsWith("/arquivos")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin-login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.json(
    {
      error: "admin_unauthorized",
      message:
        "Acesso negado. Envie o header x-nextia-admin-key com NEXTIA_ADMIN_KEY ou faça login em /admin-login.",
    },
    { status: 401 }
  );
}

export const config = {
  matcher: ["/api/admin/:path*", "/api/files/:path*", "/arquivos/:path*"],
};
