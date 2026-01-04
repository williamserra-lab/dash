import { NextRequest, NextResponse } from "next/server";

/**
 * Basic Auth (via .env / .env.local)
 *
 * Supported env var names (pick the first non-empty):
 * - NEXTIA_ADMIN_USER / NEXTIA_ADMIN_PASS
 * - ADMIN_USER / ADMIN_PASS
 * - BASIC_AUTH_USER / BASIC_AUTH_PASS
 *
 * Optional:
 * - NEXTIA_ADMIN_REALM (default: "Nextia")
 *
 * Behavior:
 * - If user+pass are not configured, auth is disabled (avoid lockout).
 * - Webhook endpoint is excluded from auth by default.
 */
function getCreds() {
  const user =
    process.env.NEXTIA_ADMIN_USER ||
    process.env.ADMIN_USER ||
    process.env.BASIC_AUTH_USER ||
    "";
  const pass =
    process.env.NEXTIA_ADMIN_PASS ||
    process.env.ADMIN_PASS ||
    process.env.BASIC_AUTH_PASS ||
    "";
  const realm = process.env.NEXTIA_ADMIN_REALM || "Nextia";
  return { user, pass, realm };
}

function unauthorized(realm: string) {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${realm}", charset="UTF-8"` },
  });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Exclusions: Next internals & public assets
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    pathname.startsWith("/assets") ||
    pathname.startsWith("/images")
  ) {
    return NextResponse.next();
  }

  // Exclusion: inbound WhatsApp webhook (must be callable)
  if (pathname.startsWith("/api/webhooks/whatsapp/inbound")) {
    return NextResponse.next();
  }

  const { user, pass, realm } = getCreds();

  // If not configured, do not block (prevents accidental lockout)
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");

  if (scheme !== "Basic" || !encoded) return unauthorized(realm);

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const u = idx >= 0 ? decoded.slice(0, idx) : "";
    const p = idx >= 0 ? decoded.slice(idx + 1) : "";

    if (u === user && p === pass) return NextResponse.next();
    return unauthorized(realm);
  } catch {
    return unauthorized(realm);
  }
}

export const config = {
  matcher: [
    /*
      Protect everything by default except:
      - Next internals/assets
      - WhatsApp inbound webhook
    */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
