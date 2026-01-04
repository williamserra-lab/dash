export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { listGroupsByClient, upsertGroup, setGroupAuthorization, setGroupStatus } from "@/lib/whatsappGroups";
void assertClientActive;

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    await assertClientActive(clientId);

    const groups = await listGroupsByClient(clientId);
    return NextResponse.json({ ok: true, groups }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao listar grupos:", error);
    return NextResponse.json({ error: "Erro interno ao listar grupos." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    await assertClientActive(clientId);

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name || "").trim();
    const groupId = String(body.groupId || "").trim();
    const authorizedForCampaigns = Boolean(body.authorizedForCampaigns);
    const status = (body.status === "paused" ? "paused" : "active") as any;

    if (!name) return NextResponse.json({ error: "Nome do grupo é obrigatório." }, { status: 400 });
    if (!groupId) return NextResponse.json({ error: "groupId é obrigatório." }, { status: 400 });

    const group = await upsertGroup({
      clientId,
      name,
      groupId,
      authorizedForCampaigns,
      status,
    });

    return NextResponse.json({ ok: true, group }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao criar/atualizar grupo:", error);
    return NextResponse.json({ error: "Erro interno ao salvar grupo." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    await assertClientActive(clientId);

    const body = await req.json().catch(() => ({} as any));
    const groupId = String(body.groupId || "").trim();

    if (!groupId) return NextResponse.json({ error: "groupId é obrigatório." }, { status: 400 });

    // Atualizações suportadas
    if (typeof body.authorizedForCampaigns === "boolean") {
      const updated = await setGroupAuthorization({
        clientId,
        groupId,
        authorizedForCampaigns: body.authorizedForCampaigns,
      });
      if (!updated) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
      return NextResponse.json({ ok: true, group: updated }, { status: 200 });
    }

    if (body.status === "active" || body.status === "paused") {
      const updated = await setGroupStatus({
        clientId,
        groupId,
        status: body.status,
      });
      if (!updated) return NextResponse.json({ error: "Grupo não encontrado." }, { status: 404 });
      return NextResponse.json({ ok: true, group: updated }, { status: 200 });
    }

    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Erro ao atualizar grupo:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar grupo." }, { status: 500 });
  }
}
