// src/app/api/clients/[clientId]/whatsapp-instances/[instanceId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { deleteWhatsappInstance, getWhatsappInstanceById, updateWhatsappInstance } from "@/lib/whatsappInstances";

type RouteContext = { params: Promise<{ clientId: string; instanceId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, instanceId } = await context.params;
    if (!clientId || !instanceId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const item = await getWhatsappInstanceById(clientId, instanceId);
    if (!item) return NextResponse.json({ error: "Instância não encontrada." }, { status: 404 });

    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, instanceId } = await context.params;
    if (!clientId || !instanceId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const body = await readJsonObject(req);
    const patch: any = {};
    if (typeof (body as any).label === "string") patch.label = String((body as any).label);
    if (typeof (body as any).instanceName === "string") patch.instanceName = String((body as any).instanceName);
    if (typeof (body as any).baseUrl === "string") patch.baseUrl = String((body as any).baseUrl);
    if (typeof (body as any).apiKey === "string") patch.apiKey = String((body as any).apiKey);
    if (typeof (body as any).active === "boolean") patch.active = (body as any).active;

    const updated = await updateWhatsappInstance(clientId, instanceId, patch);
    if (!updated) return NextResponse.json({ error: "Instância não encontrada." }, { status: 404 });

    return NextResponse.json({ ok: true, item: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, instanceId } = await context.params;
    if (!clientId || !instanceId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const ok = await deleteWhatsappInstance(clientId, instanceId);
    if (!ok) return NextResponse.json({ error: "Instância não encontrada." }, { status: 404 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
