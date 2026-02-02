export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getStoredAdminCredentials, verifyAdminKey, getEffectiveAdminSigningKey } from "@/lib/adminCredentials";

export const ADMIN_COOKIE_NAME = "nextia_admin_session";

type TokenV1 = {
  v: 1;
  exp: number; // unix seconds
  actor: string;
  sv: number; // session version
  // allow extra fields like iat
  [k: string]: unknown;
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function getExpectedAdminKey(): string {
  return getEffectiveAdminSigningKey();
}

function getAdminKeyHeader(req: NextRequest): string {
  return (req.headers.get("x-nextia-admin-key") || "").trim();
}

function getSessionTtlSeconds(): number {
  const raw = (process.env.NEXTIA_ADMIN_SESSION_TTL_SECONDS || "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 60) return Math.floor(n);
  return 60 * 60 * 24 * 7; // 7 days
}

function hmacHex(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length != bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function getDbSessionVersion(): Promise<number> {
  const stored = await getStoredAdminCredentials();
  const svRaw = (stored as any)?.sessionVersion ?? (stored as any)?.session_version;
  const svNum = typeof svRaw === "number" ? svRaw : typeof svRaw === "string" ? Number(svRaw) : NaN;
  return Number.isFinite(svNum) && svNum >= 0 ? Math.floor(svNum) : 0;
}

export function mintAdminSessionCookieValue(expectedKey: string, actor: string, sessionVersion: number): string {
  const exp = nowSec() + getSessionTtlSeconds();
  const token: TokenV1 = { v: 1, exp, actor, sv: sessionVersion, iat: nowSec() };
  const payload = Buffer.from(JSON.stringify(token), "utf-8").toString("base64url");
  const sig = hmacHex(expectedKey, payload);
  return `${payload}.${sig}`;
}

function verifyTokenV1(expectedKey: string, cookieValue: string): { ok: boolean; token?: TokenV1; reason?: string } {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return { ok: false, reason: "format" };

  const [payload, sig] = parts;
  const expectedSig = hmacHex(expectedKey, payload);
  if (!safeEq(sig, expectedSig)) return { ok: false, reason: "bad_sig" };

  let token: TokenV1;
  try {
    token = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as TokenV1;
  } catch {
    return { ok: false, reason: "bad_json" };
  }

  if (!token || token.v !== 1) return { ok: false, reason: "bad_version" };
  if (typeof token.exp !== "number" || token.exp <= nowSec()) return { ok: false, reason: "expired" };
  if (typeof token.actor !== "string" || !token.actor) return { ok: false, reason: "bad_actor" };
  if (typeof token.sv !== "number" || token.sv < 0) return { ok: false, reason: "bad_sv" };

  return { ok: true, token };
}

// Legacy cookie support: "actor|exp|sig"
function verifyLegacyCookie(expectedKey: string, cookieValue: string): { ok: boolean; actor?: string; reason?: string } {
  const parts = cookieValue.split("|");
  if (parts.length !== 3) return { ok: false, reason: "format" };
  const [actor, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= nowSec()) return { ok: false, reason: "expired" };

  const payload = `${actor}|${expStr}`;
  const expectedSig = hmacHex(expectedKey, payload);
  if (!safeEq(sig, expectedSig)) return { ok: false, reason: "bad_sig" };

  return { ok: true, actor };
}


type AuthExplain = {
  ok: boolean;
  code:
    | "ok"
    | "missing_admin_key"
    | "missing_cookie"
    | "format"
    | "bad_sig"
    | "bad_json"
    | "bad_version"
    | "expired"
    | "bad_actor"
    | "bad_sv"
    | "sv_mismatch"
    | "legacy_not_allowed";
  tokenSv?: number;
  dbSv?: number;
};

function isDebugEnabled(): boolean {
  return (process.env.NEXTIA_AUTH_DEBUG || "").trim().toLowerCase() === "true";
}

async function explainAdminAuth(req: NextRequest): Promise<AuthExplain> {
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) return { ok: false, code: "missing_admin_key" };

  const cookieValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookieValue) return { ok: false, code: "missing_cookie" };

  const dbSv = await getDbSessionVersion();

  if (cookieValue.includes(".")) {
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return { ok: false, code: "format", dbSv };

    const [payload, sig] = parts;
    const expectedSig = hmacHex(expectedKey, payload);
    if (!safeEq(sig, expectedSig)) return { ok: false, code: "bad_sig", dbSv };

    let token: TokenV1;
    try {
      token = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as TokenV1;
    } catch {
      return { ok: false, code: "bad_json", dbSv };
    }

    if (!token || token.v !== 1) return { ok: false, code: "bad_version", dbSv };
    if (typeof token.exp !== "number" || token.exp <= nowSec()) return { ok: false, code: "expired", dbSv };
    if (typeof token.actor !== "string" || !token.actor) return { ok: false, code: "bad_actor", dbSv };
    if (typeof token.sv !== "number" || token.sv < 0) return { ok: false, code: "bad_sv", dbSv };

    if (token.sv !== dbSv) return { ok: false, code: "sv_mismatch", tokenSv: token.sv, dbSv };
    return { ok: true, code: "ok", tokenSv: token.sv, dbSv };
  }

  // Legacy token only valid when db session version is 0
  if (dbSv !== 0) return { ok: false, code: "legacy_not_allowed", dbSv };

  const legacy = verifyLegacyCookie(expectedKey, cookieValue);
  if (!legacy.ok) return { ok: false, code: legacy.reason === "bad_sig" ? "bad_sig" : "format", dbSv };

  return { ok: true, code: "ok", dbSv };
}

export async function isAdminAuthorized(req: NextRequest): Promise<boolean> {
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) return false;

  // Break-glass: allow admin-key header (useful for recovery / automation)
  const headerKey = getAdminKeyHeader(req);
  if (headerKey) {
    const keyAuth = await verifyAdminKey(headerKey);
    if (keyAuth.ok) return true;
  }

  const cookieValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookieValue) return false;

  // Prefer v1 token (payload.sig)
  if (cookieValue.includes(".")) {
    const v1 = verifyTokenV1(expectedKey, cookieValue);
    if (!v1.ok || !v1.token) return false;

    const dbSv = await getDbSessionVersion();
    return v1.token.sv === dbSv;
  }

  // Legacy token only valid when db session version is 0
  const dbSv = await getDbSessionVersion();
  if (dbSv !== 0) return false;

  const legacy = verifyLegacyCookie(expectedKey, cookieValue);
  return legacy.ok;
}

/**
 * Best-effort: extract the authenticated admin "actor" (username) when possible.
 * Returns null when not authorized or when actor cannot be determined.
 */
export async function getAdminActor(req: NextRequest): Promise<string | null> {
  const expectedKey = getExpectedAdminKey();
  if (!expectedKey) return null;

  // Break-glass header
  const headerKey = getAdminKeyHeader(req);
  if (headerKey) {
    const keyAuth = await verifyAdminKey(headerKey);
    if (keyAuth.ok) return keyAuth.actor || "admin-key";
  }

  const cookieValue = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookieValue) return null;

  // v1 token
  if (cookieValue.includes(".")) {
    const v1 = verifyTokenV1(expectedKey, cookieValue);
    if (!v1.ok || !v1.token) return null;
    const dbSv = await getDbSessionVersion();
    if (v1.token.sv !== dbSv) return null;
    return String(v1.token.actor || "admin");
  }

  // legacy
  const dbSv = await getDbSessionVersion();
  if (dbSv !== 0) return null;
  const legacy = verifyLegacyCookie(expectedKey, cookieValue);
  return legacy.ok ? String(legacy.actor || "admin") : null;
}

function parseCsvEnv(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * SUPERADMIN gate.
 * - If NEXTIA_SUPERADMIN_ACTORS is set (comma-separated), only those actors are allowed.
 * - If not set, falls back to any authorized admin (MVP compatibility).
 */
export async function requireSuperAdmin(req: NextRequest): Promise<NextResponse | null> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const allow = parseCsvEnv("NEXTIA_SUPERADMIN_ACTORS");
  if (allow.length === 0) return null; // backward compatible

  const actor = await getAdminActor(req);
  if (actor && allow.includes(actor)) return null;

  return NextResponse.json(
    { error: "superadmin_required", message: "Ação restrita a SUPERADMIN." },
    { status: 403 }
  );
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdminAuthorized(req)) return null;

  return NextResponse.json(
    { error: "admin_unauthorized", message: "Acesso negado. Faça login em /admin-login ou envie o header x-nextia-admin-key (NEXTIA_ADMIN_KEY)." },
    { status: 401 }
  );
}

export function getAdminSessionCookieOptions(req?: NextRequest): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
  path: string;
} {
  const raw = (process.env.NEXTIA_COOKIE_SECURE || "").trim().toLowerCase();
  const override = raw === "true" ? true : raw === "false" ? false : undefined;

  const isHttps =
    req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" ||
    req?.nextUrl?.protocol === "https:";

  const secure =
    typeof override === "boolean"
      ? override
      : process.env.NODE_ENV === "production"
        ? Boolean(isHttps)
        : false;

  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: getSessionTtlSeconds(),
    path: "/",
  };
}
