// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

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
  if (!got || !expected) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

function sign(secret: string, ts: string): string {
  return createHmac("sha256", secret).update(ts).digest("hex");
}

async function cookieAdminAuthorized(req: NextRequest, expected: string): Promise<boolean> {
  const cookie = (req.cookies.get(COOKIE_NAME)?.value || "").trim();
  if (!cookie) return false;

  const [ts, sig] = cookie.split(".");
  if (!ts || !sig) return false;

  const age = Math.floor((Date.now() - Number(ts)) / 1000);
  if (!Number.isFinite(age) || age < 0 || age > SESSION_TTL_SECONDS) return false;

  const expectedSig = sign(expected, ts);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
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
  // Login page + auth endpoints must remain reachable.
  if (pathname === "/admin-login") return true;
  if (pathname === "/api/admin/auth/login") return true;
  if (pathname === "/api/admin/auth/logout") return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isBypassPath(pathname)) return NextResponse.next();

  const ok = await isAdminAuthorized(req);
  if (ok) return NextResponse.next();

  // API: return 401 JSON. Pages: redirect to login.
  if (isApiPath(pathname)) {
    return NextResponse.json(
      {
        error: "admin_unauthorized",
        message:
          "Acesso negado. Envie o header x-nextia-admin-key com NEXTIA_ADMIN_KEY ou faça login em /admin-login.",
      },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/admin-login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/api/files/:path*",
    "/arquivos/:path*",
    "/painel/:path*",
    "/clientes/:path*",
    "/contatos/:path*",
    "/grupos/:path*",
    "/midias/:path*",
    "/campanhas/:path*",
    "/campanhas-grupos/:path*",
    "/agendamentos/:path*",
    "/pedidos/:path*",
    "/configuracoes/:path*",
    "/assistente/:path*",
  ],
};
