import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "nextia_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function unauthorizedApi() {
  return NextResponse.json(
    {
      error: "admin_unauthorized",
      message:
        "Acesso negado. Envie o header x-nextia-admin-key com NEXTIA_ADMIN_KEY ou faça login em /admin-login.",
    },
    { status: 401 }
  );
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/admin-login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

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

function bytesToHex(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
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
  return bytesToHex(sig);
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

function basicAuthMatches(req: NextRequest): boolean {
  const user = (process.env.NEXTIA_ADMIN_USER || "").trim();
  const pass = (process.env.NEXTIA_ADMIN_PASS || "").trim();
  if (!user || !pass) return false;

  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;

  const base64 = header.slice(6).trim();
  let decoded = "";
  try {
    decoded = atob(base64);
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
  const p = sep >= 0 ? decoded.slice(sep + 1) : "";

  return u === user && p === pass;
}

function isBypassPath(pathname: string): boolean {
  // Login must be reachable without prior auth
  if (pathname === "/admin-login") return true;
  if (pathname === "/api/admin/auth/login") return true;
  // Allow logout without forcing auth (it only clears cookie)
  if (pathname === "/api/admin/auth/logout") return true;
  return false;
}

async function isAdminAuthorized(req: NextRequest): Promise<boolean> {
  const expected = getExpectedAdminKey();

  if (!expected) {
    // Fail-closed in prod, allow in dev
    return isDevModeAllowed();
  }

  if (headerAdminKeyMatches(req, expected)) return true;
  if (await cookieAdminAuthorized(req, expected)) return true;

  // Back-compat (optional): allow Basic auth if configured
  if (basicAuthMatches(req)) return true;

  return false;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isBypassPath(pathname)) return NextResponse.next();

  const mustAuth =
    pathname === "/clientes" ||
    pathname.startsWith("/clientes/") ||
    pathname === "/painel" ||
    pathname.startsWith("/painel/") ||
    pathname === "/arquivos" ||
    pathname.startsWith("/arquivos/") ||
    pathname.startsWith("/api/admin/") ||
    pathname === "/api/clients" ||
    pathname.startsWith("/api/clients/") ||
    pathname.startsWith("/api/files/"); // deprecated endpoints

  if (!mustAuth) return NextResponse.next();

  const ok = await isAdminAuthorized(req);
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) return unauthorizedApi();
  return redirectToLogin(req);
}

export const config = {
  matcher: [
    "/clientes/:path*",
    "/painel/:path*",
    "/arquivos/:path*",
    "/api/admin/:path*",
    "/api/clients/:path*",
    "/api/files/:path*",
  ],
};
