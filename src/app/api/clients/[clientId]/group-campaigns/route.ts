export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { createGroupCampaign, listGroupCampaigns } from "@/lib/groupCampaigns";
import { listAuthorizedGroupsByClient } from "@/lib/whatsappGroups";
void assertClientActive;

type RouteContext = {
  params: Promise<{ clientId: string }>;
};

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    await assertClientActive(clientId);

    const campaigns = await listGroupCampaigns(clientId);
    return NextResponse.json({ ok: true, campaigns }, { status: 200 });
  } catch (error) {
    if (error instanceof ClientAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Erro ao listar campanhas de grupos:", error);
    return NextResponse.json({ error: "Erro interno ao listar campanhas." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    await assertClientActive(clientId);

    const body = await req.json().catch(() => ({} as any));
    const name = String(body.name || "").trim();
    const message = String(body.message || "").trim();
    const paceProfile = (body.paceProfile || "safe") as any;
    const groupIds = Array.isArray(body.groupIds) ? body.groupIds.map(String) : [];

    if (!name) return NextResponse.json({ error: "Nome da campanha é obrigatório." }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Mensagem é obrigatória." }, { status: 400 });
    if (!groupIds.length) return NextResponse.json({ error: "Selecione ao menos 1 grupo." }, { status: 400 });

    // Segurança: só permite grupos previamente autorizados
    const authorized = await listAuthorizedGroupsByClient(clientId);
    const allowed = new Set(authorized.map((g) => g.groupId));
    const filtered = groupIds.filter((gid: string) => allowed.has(String(gid).trim()));

    if (!filtered.length) {
      return NextResponse.json(
        { error: "Nenhum dos grupos selecionados está autorizado para campanhas." },
        { status: 400 }
      );
    }

    const campaign = await createGroupCampaign({
      clientId,
      name,
      message,
      groupIds: filtered,
      paceProfile,
    });

    return NextResponse.json({ ok: true, campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientAccessError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error("Erro ao criar campanha de grupos:", error);
    return NextResponse.json({ error: (error as any)?.message || "Erro interno ao criar campanha." }, { status: 500 });
  }
}
