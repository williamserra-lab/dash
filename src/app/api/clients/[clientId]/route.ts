// src/app/api/clients/[clientId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getClientById, updateClient } from "@/lib/clients";
import { readJsonObject } from "@/lib/http/body";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { clientId } = await context.params;

  await assertClientActive(clientId);
  const client = await getClientById(clientId);

  if (!client) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ client }, { status: 200 });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { clientId } = await context.params;

  const body = await readJsonObject(req);

  // LOJISTA pode editar apenas cadastro (name/profile). Campos de plano/billing/acesso/números são SUPERADMIN-only.
  const allowedKeys = new Set(["name", "profile"]);
  const providedKeys = Object.keys(body || {});
  const forbiddenKeys = providedKeys.filter((k) => !allowedKeys.has(k));
  if (forbiddenKeys.length > 0) {
    return NextResponse.json(
      {
        error: "forbidden_fields",
        message:
          "Você não tem permissão para alterar estes campos. (plan/billing/access/whatsappNumbers/status/segment são SUPERADMIN.)",
        fields: forbiddenKeys,
      },
      { status: 403 }
    );
  }

  try {
    const client = await updateClient(clientId, {
      name: (body as any)?.name,
      profile: (body as any)?.profile,
    });

    return NextResponse.json({ client }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ClientAccessError) {
      const e = err as ClientAccessError;
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status }
      );
    }

    const msgRaw = getErrorMessage(err) || "Erro ao atualizar cliente.";
    const status = msgRaw.includes("não encontrado") || msgRaw.includes("inválido") ? 404 : 400;
    return NextResponse.json({ error: msgRaw }, { status });
  }
}
