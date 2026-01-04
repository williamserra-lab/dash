export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const COOKIE_NAME = "nextia_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

type Body = { key?: string };

function getExpectedAdminKey(): string {
  return (process.env.NEXTIA_ADMIN_KEY || "").trim();
}

function isDevModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function readJsonSafe(req: NextRequest): Promise<Body> {
  const raw = await req.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Body;
  } catch {
    return {};
  }
}

function sign(secret: string, ts: string): string {
  return createHmac("sha256", secret).update(ts).digest("hex");
}

export async function POST(req: NextRequest) {
  const expected = getExpectedAdminKey();

  const body = await readJsonSafe(req);
  const got = String(body?.key || "").trim();

  if (!expected) {
    if (!isDevModeAllowed()) {
      return NextResponse.json(
        { error: "admin_key_missing", message: "NEXTIA_ADMIN_KEY não configurada." },
        { status: 500 }
      );
    }
    // Dev mode: allow login even without configured key.
  } else {
    if (!got || got !== expected) {
      return NextResponse.json(
        { error: "admin_unauthorized", message: "Chave inválida." },
        { status: 401 }
      );
    }
  }

  const secret = expected || "dev";
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
