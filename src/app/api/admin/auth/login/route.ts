export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { mintAdminSessionCookieValue, getAdminSessionCookieOptions } from "@/lib/adminAuth";
import { verifyAdminUserPass, getStoredAdminCredentials, getEffectiveAdminSigningKey } from "@/lib/adminCredentials";

type Body = { username?: string; password?: string };

declare global {
  // eslint-disable-next-line no-var
  var __nextiaAdminLoginRate: Map<string, { count: number; startSec: number }> | undefined;
}

function getExpectedAdminKey(): string {
  return getEffectiveAdminSigningKey();
}

function getRateLimitCfg(): { max: number; windowSec: number } {
  const max = Number((process.env.NEXTIA_ADMIN_LOGIN_MAX_ATTEMPTS || "").trim() || "10");
  const windowSec = Number((process.env.NEXTIA_ADMIN_LOGIN_WINDOW_SECONDS || "").trim() || "300");
  return {
    max: Number.isFinite(max) && max > 0 ? Math.floor(max) : 10,
    windowSec: Number.isFinite(windowSec) && windowSec > 30 ? Math.floor(windowSec) : 300,
  };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getClientIp(req: NextRequest): string {
  const xf = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  if (xf) return xf;
  const xr = (req.headers.get("x-real-ip") || "").trim();
  if (xr) return xr;
  // NextRequest doesn't always expose ip reliably; fallback to empty bucket.
  return "unknown";
}

function isRateLimited(req: NextRequest): { limited: boolean; retryAfterSec?: number } {
  const { max, windowSec } = getRateLimitCfg();
  if (!global.__nextiaAdminLoginRate) global.__nextiaAdminLoginRate = new Map();

  const ip = getClientIp(req);
  const key = `ip:${ip}`;
  const entry = global.__nextiaAdminLoginRate.get(key);
  const t = nowSec();

  if (!entry) {
    global.__nextiaAdminLoginRate.set(key, { count: 1, startSec: t });
    return { limited: false };
  }

  if (t - entry.startSec >= windowSec) {
    global.__nextiaAdminLoginRate.set(key, { count: 1, startSec: t });
    return { limited: false };
  }

  entry.count += 1;
  global.__nextiaAdminLoginRate.set(key, entry);

  if (entry.count > max) {
    const retry = Math.max(1, windowSec - (t - entry.startSec));
    return { limited: true, retryAfterSec: retry };
  }

  return { limited: false };
}

export async function POST(req: NextRequest) {
  const expectedKey = getExpectedAdminKey();

  // Production safety: do not allow login if key missing.
  if (process.env.NODE_ENV === "production" && !expectedKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_key_not_configured",
        message: "Chave de sessão admin não configurada. Configure NEXTIA_ADMIN_KEY ou NEXTIA_ADMIN_USER/NEXTIA_ADMIN_PASS.",
      },
      { status: 500 }
    );
  }

  const rl = isRateLimited(req);
  if (rl.limited) {
    const res = NextResponse.json(
      { ok: false, error: "rate_limited", message: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 }
    );
    if (rl.retryAfterSec) res.headers.set("Retry-After", String(rl.retryAfterSec));
    return res;
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  // Determine current session version
  const stored = await getStoredAdminCredentials();
  const currentSv = stored?.session_version ?? 0;

  // Normal user/pass
  const v = await verifyAdminUserPass(body.username || "", body.password || "");
  if (!v.ok) {
    return NextResponse.json(
      { ok: false, error: "invalid_credentials", message: v.message || "Credenciais inválidas." },
      { status: 401 }
    );
  }

  const actor = v.actor || "admin";
  const sv = typeof v.sessionVersion === "number" ? v.sessionVersion : currentSv;

  const cookieVal = mintAdminSessionCookieValue(expectedKey, actor, sv);
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set("nextia_admin_session", cookieVal, getAdminSessionCookieOptions(req));

  return res;
}
async function resolveSessionVersion(): Promise<number> {
  const stored = await getStoredAdminCredentials();
  // DB field is session_version (snake_case)
  const sv = (stored as any)?.session_version;
  return typeof sv === "number" ? sv : 0;
}


