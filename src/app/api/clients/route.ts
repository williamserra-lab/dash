import { NextRequest, NextResponse } from "next/server";
import { createClient, listClients } from "@/lib/clients";
import { createHmac, timingSafeEqual } from "crypto";

// helper local: evita depender de "@/lib/phone" (não existe no projeto)
function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function isAdminAuthorized(req: NextRequest): boolean {
  const expected = (process.env.NEXTIA_ADMIN_KEY || "").trim();

  // In dev, allow running without configuring the key.
  if (!expected) return process.env.NODE_ENV !== "production";

  // 1) Prefer cookie-based admin session (set by /api/admin/auth/login)
  const session = req.cookies.get("nextia_admin_session")?.value || "";
  if (session) {
    const ok = verifySessionCookie(expected, session);
    if (ok) return true;
  }

  // 2) Back-compat: allow header-based admin key (useful for scripts)
  const got = req.headers.get("x-nextia-admin-key") || "";
  return got === expected;
}

function verifySessionCookie(secret: string, cookieValue: string): boolean {
  // cookie format: "<ts>.<sig>"
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;

  // TTL: 7 days (same as middleware/login)
  const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
  if (Date.now() - ts > maxAgeMs) return false;

  const expectedSig = sign(secret, tsStr);
  return safeEq(sig, expectedSig);
}

function sign(secret: string, ts: string): string {
  return createHmac("sha256", secret).update(ts).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}


export async function GET() {
  const clients = await listClients();
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json(
      {
        error: "admin_unauthorized",
        message:
          "Criação de cliente é restrita ao SUPERADMIN. Envie x-nextia-admin-key.",
      },
      { status: 401 }
    );
  }

  try {
    const body: any = await req.json();

    const patch: any = {
      id: body?.id,
      name: body?.name,
      segment: body?.segment,
      status: body?.status || "active",
    };

    // Compatibilidade: aceitar whatsappNumber simples (string)
    if (!patch.whatsappNumbers && body?.whatsappNumber) {
      const pn = digitsOnly(body.whatsappNumber);
      if (pn) {
        patch.whatsappNumbers = [{ id: "w1", phoneNumber: pn, active: true }];
      }
    }

    // Forma canônica: aceitar whatsappNumbers (array)
    if (Array.isArray(body?.whatsappNumbers)) {
      patch.whatsappNumbers = body.whatsappNumbers;
    }

    // Profile administrativo (JSONB)
    if (body?.profile && typeof body.profile === "object") {
      patch.profile = body.profile;
    }

    const client = await createClient(patch);
    return NextResponse.json({ client }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 400 }
    );
  }
}