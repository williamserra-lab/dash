import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "nextia_admin_session";

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

function headerAdminAuthorized(req: NextRequest): boolean {
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) return false;
  const got = (req.headers.get("x-nextia-admin-key") || "").trim();
  return Boolean(got) && safeEq(got, expectedKey);
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function base64urlToBytes(s: string): Uint8Array {
  // atob wants standard base64 with padding
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function safeEq(a: string, b: string): boolean {
  // simple constant-time-ish compare
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacHex(key: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(payload));
  return bytesToHex(sig);
}

type TokenV1 = {
  v: 1;
  exp: number;
  actor: string;
  sv: number;
  [k: string]: unknown;
};

async function verifyV1Cookie(expectedKey: string, cookieValue: string): Promise<boolean> {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [payload, sigHex] = parts;

  const expectedSigHex = await hmacHex(expectedKey, payload);
  if (!safeEq(sigHex.toLowerCase(), expectedSigHex.toLowerCase())) return false;

  let token: TokenV1;
  try {
    const json = new TextDecoder().decode(base64urlToBytes(payload));
    token = JSON.parse(json) as TokenV1;
  } catch {
    return false;
  }

  if (!token || token.v !== 1) return false;
  if (typeof token.exp !== "number" || token.exp <= nowSec()) return false;
  if (typeof token.actor !== "string" || !token.actor) return false;
  if (typeof token.sv !== "number" || token.sv < 0) return false;

  // IMPORTANT: proxy layer only validates signature + expiry.
  // SessionVersion revocation is enforced in API via requireAdmin() (single source of truth).
  return true;
}

// Legacy cookie: actor|exp|sigHex (sig on "actor|exp")
async function verifyLegacyCookie(expectedKey: string, cookieValue: string): Promise<boolean> {
  const parts = cookieValue.split("|");
  if (parts.length !== 3) return false;

  const [actor, expStr, sigHex] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowSec()) return false;
  if (!actor) return false;

  const payload = `${actor}|${expStr}`;
  const expectedSigHex = await hmacHex(expectedKey, payload);
  return safeEq(sigHex.toLowerCase(), expectedSigHex.toLowerCase());
}

async function cookieAdminAuthorized(req: NextRequest): Promise<boolean> {
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) return false;

  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookieValue) return false;

  if (cookieValue.includes(".")) return await verifyV1Cookie(expectedKey, cookieValue);
  return await verifyLegacyCookie(expectedKey, cookieValue);
}

function shouldProtect(pathname: string): boolean {
  // Protected areas
  if (pathname.startsWith("/api/admin")) return true;
  if (pathname.startsWith("/api/clients")) return true;
  if (pathname.startsWith("/api/files")) return true;
  if (pathname.startsWith("/clientes")) return true;
  return false;
}

function isPublicPath(pathname: string): boolean {
  if (pathname === "/admin-login" || pathname === "/login") return true;
  if (pathname === "/api/admin/auth/login") return true;
  if (pathname === "/api/admin/auth/logout") return true;
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt") return true;
  return false;
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/admin-login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

/**
 * Next.js proxy entrypoint (Edge).
 * MUST export either default function or named `proxy`.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) return NextResponse.next();
  if (!shouldProtect(pathname)) return NextResponse.next();

  const ok = await cookieAdminAuthorized(req);
  if (ok || headerAdminAuthorized(req)) return NextResponse.next();

  // APIs return 401 JSON; pages redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "admin_unauthorized",
        message:
          "Acesso negado. Faça login em /admin-login (NEXTIA_ADMIN_USER/PASS) ou envie o header x-nextia-admin-key (NEXTIA_ADMIN_KEY).",
      },
      { status: 401 }
    );
  }

  return redirectToLogin(req);
}

export const config = {
  // IMPORTANTE: não use matcher amplo "/api/:path*" pois isso faz o middleware
  // interceptar webhooks (ex.: /api/webhooks/evolution) e ativa o limite prático de 10MB.
  // Protegemos apenas as áreas necessárias.
  matcher: [
    "/api/admin/:path*",
    "/api/clients/:path*",
    "/api/files/:path*",
    "/clientes/:path*",
    "/admin-login",
    "/login",
  ],
};
