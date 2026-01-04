// src/app/api/clients/[clientId]/contacts/[contactId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getContactById, patchContact } from "@/lib/contacts";
void assertClientActive;

type RouteContext = {
  params: Promise<{
    clientId: string;
    contactId: string;
  }>;
};

type PatchBody = {
  name?: string;
  vip?: boolean;
  optOutMarketing?: boolean;
  blockedGlobal?: boolean;
};

export async function PATCH(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, contactId } = await context.params;

    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório na rota." }, { status: 400 });
    await assertClientActive(clientId);

    if (!contactId) return NextResponse.json({ error: "contactId é obrigatório." }, { status: 400 });

    const body = (await req.json()) as PatchBody;
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
    }

    // Tenant safety: valida antes.
    const existing = await getContactById(clientId, contactId);
    if (!existing) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    const updated = await patchContact(contactId, body);
    if (!updated) {
      return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
    }

    return NextResponse.json({ contact: updated }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }

    console.error("Erro ao atualizar contato:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar contato." }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, contactId } = await context.params;

    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório na rota." }, { status: 400 });
    await assertClientActive(clientId);

    if (!contactId) return NextResponse.json({ error: "contactId é obrigatório." }, { status: 400 });

    const contact = await getContactById(clientId, contactId);
    if (!contact) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

    return NextResponse.json({ contact }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }

    console.error("Erro ao buscar contato:", error);
    return NextResponse.json({ error: "Erro interno ao buscar contato." }, { status: 500 });
  }
}
