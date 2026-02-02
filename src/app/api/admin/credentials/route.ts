export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getStoredAdminCredentials, setAdminCredentials } from "@/lib/adminCredentials";

type Body = {
  username?: string;
  password?: string;
};

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const stored = await getStoredAdminCredentials();

  // Não vaza nada sensível. Só informa se está configurado e qual username.
  return NextResponse.json(
    {
      ok: true,
      // Backward-compat
      configured: Boolean(stored),
      // UI-friendly fields
      hasCredentials: Boolean(stored),
      sessionVersion: stored?.session_version ?? 0,
      username: stored?.username ?? null,
    },
    { status: 200 }
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // mantém body vazio; validação abaixo irá rejeitar
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json(
      { ok: false, error: "missing_fields", message: "Informe usuário e senha." },
      { status: 400 }
    );
  }

  // FIX: setAdminCredentials espera (username, password), não objeto
  const r = await setAdminCredentials(username, password);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: "set_failed", message: r.message ?? "Falha ao salvar credenciais." },
      { status: 400 }
    );
  }

  // Não depende de sessionVersion no retorno (evita quebra de tipagem).
  return NextResponse.json({ ok: true }, { status: 200 });
}

// Alias for clients that use PUT
export async function PUT(req: NextRequest): Promise<Response> {
  return POST(req);
}
