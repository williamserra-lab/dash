// src/lib/adminCredentials.ts
// Admin credentials stored in Postgres (hash + session version).
//
// Production goals:
// - No plaintext password stored
// - Session invalidation via session_version bump
// - Deterministic bootstrap:
//    * Primary: DB stored credentials (username + scrypt hash)
//    * Secondary (bootstrap only, when DB empty): NEXTIA_ADMIN_USER / NEXTIA_ADMIN_PASS
// - Break-glass: NEXTIA_ADMIN_KEY (allows access recovery; never stored)
//
// This module MUST stay runtime=nodejs (uses crypto + pg).

export const runtime = "nodejs";

import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";
import { dbQuery, isDbEnabled } from "@/lib/db";

export type StoredAdminCredentials = {
  username: string;
  pass_algo: "scrypt";
  pass_salt_hex: string;
  pass_hash_hex: string;
  pass_n: number;
  pass_r: number;
  pass_p: number;
  session_version: number;
};

const SINGLETON_ID = 1;

function normalizeUser(u: string): string {
  return (u || "").trim();
}

function getEnvAdminUserPass(): { user: string; pass: string } {
  return {
    user: (process.env.NEXTIA_ADMIN_USER || "").trim(),
    pass: (process.env.NEXTIA_ADMIN_PASS || "").trim(),
  };
}

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

export function hasBootstrapKeyConfigured(): boolean {
  return Boolean(getExpectedAdminKey());
}

function scryptParamsFromEnv(): { N: number; r: number; p: number } {
  const N = Number((process.env.NEXTIA_ADMIN_SCRYPT_N || "").trim() || "16384");
  const r = Number((process.env.NEXTIA_ADMIN_SCRYPT_R || "").trim() || "8");
  const p = Number((process.env.NEXTIA_ADMIN_SCRYPT_P || "").trim() || "1");
  return {
    N: Number.isFinite(N) && N >= 1024 ? Math.floor(N) : 16384,
    r: Number.isFinite(r) && r >= 1 ? Math.floor(r) : 8,
    p: Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1,
  };
}

function computeScrypt(password: string, saltHex: string, N: number, r: number, p: number): string {
  const salt = Buffer.from(saltHex, "hex");
  const dk = scryptSync(password, salt, 64, { N, r, p });
  return dk.toString("hex");
}

export async function getStoredAdminCredentials(): Promise<StoredAdminCredentials | null> {
  if (!isDbEnabled()) return null;

  const res = await dbQuery<StoredAdminCredentials>(
    `SELECT username, pass_algo, pass_salt_hex, pass_hash_hex, pass_n, pass_r, pass_p, session_version
     FROM nextia_admin_credentials
     WHERE id = $1
     LIMIT 1;`,
    [SINGLETON_ID]
  );

  return res.rows?.[0] ?? null;
}

async function getCurrentSessionVersion(): Promise<number> {
  const stored = await getStoredAdminCredentials();
  return stored?.session_version ?? 0;
}

export async function verifyAdminKey(key: string): Promise<{
  ok: boolean;
  actor?: string;
  sessionVersion?: number;
  message?: string;
}> {
  const expected = getExpectedAdminKey();
  if (!expected) return { ok: false, message: "NEXTIA_ADMIN_KEY not configured." };

  const provided = (key || "").trim();
  if (!provided) return { ok: false, message: "Missing key." };

  // Constant-time compare when lengths match.
  const expB = Buffer.from(expected, "utf8");
  const gotB = Buffer.from(provided, "utf8");
  const ok =
    expB.length === gotB.length ? timingSafeEqual(expB, gotB) : false;

  if (!ok) return { ok: false, message: "Invalid key." };

  return { ok: true, actor: "admin-key", sessionVersion: await getCurrentSessionVersion() };
}

export async function verifyAdminUserPass(username: string, password: string): Promise<{
  ok: boolean;
  actor?: string;
  sessionVersion?: number;
  message?: string;
}> {
  const u = normalizeUser(username);
  const p = (password || "").toString();

  if (!u || !p) return { ok: false, message: "Missing username/password." };

  // Super-admin via ENV always valid (even if DB credentials exist).
  const envCreds = getEnvAdminUserPass();
  if (envCreds.user && envCreds.pass && u === normalizeUser(envCreds.user) && p === String(envCreds.pass)) {
    const stored = await getStoredAdminCredentials();
    return { ok: true, actor: envCreds.user || "admin", sessionVersion: stored?.session_version ?? 0 };
  }


  // Prefer DB credentials if available.
  const stored = await getStoredAdminCredentials();
  if (stored) {
    if (normalizeUser(stored.username) !== u) return { ok: false, message: "Invalid username/password." };
    if (stored.pass_algo !== "scrypt") return { ok: false, message: "Unsupported password algorithm." };

    try {
      const computed = computeScrypt(p, stored.pass_salt_hex, stored.pass_n, stored.pass_r, stored.pass_p);
      const a = Buffer.from(stored.pass_hash_hex, "hex");
      const b = Buffer.from(computed, "hex");
      const ok = a.length === b.length ? timingSafeEqual(a, b) : false;
      return ok
        ? { ok: true, actor: stored.username || "admin", sessionVersion: stored.session_version ?? 0 }
        : { ok: false, message: "Invalid username/password." };
    } catch {
      return { ok: false, message: "Invalid username/password." };
    }
  }

  // Bootstrap-only fallback (DB empty).
  const env = getEnvAdminUserPass();
  if (!env.user || !env.pass) return { ok: false, message: "Admin credentials not configured." };
  if (normalizeUser(env.user) !== u) return { ok: false, message: "Invalid username/password." };

  const ok = Buffer.from(env.pass, "utf8").length === Buffer.from(p, "utf8").length
    ? timingSafeEqual(Buffer.from(env.pass, "utf8"), Buffer.from(p, "utf8"))
    : false;

  return ok
    ? { ok: true, actor: env.user || "admin", sessionVersion: 0 }
    : { ok: false, message: "Invalid username/password." };
}

export async function setAdminCredentials(username: string, password: string): Promise<{
  ok: boolean;
  message?: string;
}> {
  const u = normalizeUser(username);
  const p = (password || "").toString();

  if (!isDbEnabled()) return { ok: false, message: "DB not enabled." };
  if (!u || !p) return { ok: false, message: "Missing username/password." };

  const { N, r, p: P } = scryptParamsFromEnv();
  const saltHex = randomBytes(16).toString("hex");
  const hashHex = computeScrypt(p, saltHex, N, r, P);

  // Upsert singleton row and bump session_version to invalidate existing sessions.
  await dbQuery(
    `INSERT INTO nextia_admin_credentials
      (id, username, pass_algo, pass_salt_hex, pass_hash_hex, pass_n, pass_r, pass_p, session_version)
     VALUES
      ($1, $2, 'scrypt', $3, $4, $5, $6, $7, 1)
     ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      pass_algo = EXCLUDED.pass_algo,
      pass_salt_hex = EXCLUDED.pass_salt_hex,
      pass_hash_hex = EXCLUDED.pass_hash_hex,
      pass_n = EXCLUDED.pass_n,
      pass_r = EXCLUDED.pass_r,
      pass_p = EXCLUDED.pass_p,
      session_version = nextia_admin_credentials.session_version + 1;`,
    [SINGLETON_ID, u, saltHex, hashHex, N, r, P]
  );

  return { ok: true };
}

export async function bumpAdminSessionVersion(): Promise<number> {
  if (!isDbEnabled()) return 0;

  const res = await dbQuery<{ session_version: number }>(
    `UPDATE nextia_admin_credentials
     SET session_version = session_version + 1
     WHERE id = $1
     RETURNING session_version;`,
    [SINGLETON_ID]
  );

  // If row doesn't exist yet, treat as 0.
  return res.rows?.[0]?.session_version ?? 0;
}

// Backward-compatible alias (some routes may still import this).
export async function invalidateAdminSessions(): Promise<number> {
  return bumpAdminSessionVersion();
}
export function getEffectiveAdminSigningKey(): string {
  const key = getExpectedAdminKey();
  if (key) return key;

  // Deterministic fallback derived from ENV admin user/pass.
  const envCreds = getEnvAdminUserPass();
  const seed = `nextia_admin_signing:${normalizeUser(envCreds.user)}:${String(envCreds.pass || "")}`;
  return createHash("sha256").update(seed).digest("hex");
}
