export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "nextia_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type Body = { key?: string; username?: string; password?: string };

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

function isDevModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function getExpectedUserPass(): { user: string; pass: string } {
  return {
    user: (process.env.NEXTIA_ADMIN_USER || "").trim(),
    pass: (process.env.NEXTIA_ADMIN_PASS || "").trim(),
  };
}

function validateUserPass(body: Body, expectedKey: string): { ok: boolean; message?: string } {
  const u = (body.username || "").trim();
  const p = (body.password || "").trim();

  if (!u || !p) return { ok: false, message: "Usuário e senha são obrigatórios." };

  const env = getExpectedUserPass();
  if (env.user && env.pass) {
    if (!safeEq(u, env.user) || !safeEq(p, env.pass)) {
      return { ok: false, message: "Credenciais inválidas." };
    }
    return { ok: true };
  }

  // Fallback determinístico (sem depender de CLI):
  // - usuário: admin
  // - senha: NEXTIA_ADMIN_KEY
  if (!expectedKey) {
    // Em dev sem key configurada, mantém compatibilidade com o modo aberto.
    if (isDevModeAllowed()) return { ok: true };
    return { ok: false, message: "NEXTIA_ADMIN_KEY não configurada em produção." };
  }

  if (!safeEq(u, "admin") || !safeEq(p, expectedKey)) {
    return { ok: false, message: "Credenciais inválidas." };
  }

  return { ok: true };
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }

  const expectedKey = getExpectedAdminKey();

  // Back-compat: permitir login via "key" (casos antigos)
  if (typeof body.key === "string" && body.key.trim()) {
    const key = body.key.trim();
    if (!expectedKey) {
      if (!isDevModeAllowed()) {
        return NextResponse.json(
          { ok: false, error: "admin_key_not_configured", message: "NEXTIA_ADMIN_KEY não configurada." },
          { status: 401 }
        );
      }
    } else if (!safeEq(key, expectedKey)) {
      return NextResponse.json(
        { ok: false, error: "invalid_key", message: "Chave inválida." },
        { status: 401 }
      );
    }
  } else {
    const v = validateUserPass(body, expectedKey);
    if (!v.ok) {
      return NextResponse.json(
        { ok: false, error: "invalid_credentials", message: v.message || "Credenciais inválidas." },
        { status: 401 }
      );
    }
  }

  // Cookie assinado com a chave esperada; em dev sem key, usa segredo local.
  const secret = expectedKey || (isDevModeAllowed() ? "dev-secret" : "");
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "admin_key_not_configured", message: "NEXTIA_ADMIN_KEY não configurada." },
      { status: 401 }
    );
  }

  const ts = String(Date.now());
  const sig = sign(secret, ts);

  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(COOKIE_NAME, `${ts}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });

  return res;
}
